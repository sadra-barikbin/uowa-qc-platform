import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
    Indicator, IndicatorCriterion, Submission, SubmissionDocument, Evaluation,
    Department, College, EvaluationPeriod, Setting,
} from '../models';
import { SETTING_AI_EVAL_PROMPT, DEFAULT_AI_EVAL_SYSTEM_PROMPT, renderSystemPrompt } from './aiPrompt';

// Default to Sonnet 5 (fast, reads Arabic + PDFs well); override via env to escalate to Opus.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
// Must match where the submission routes actually store files: the desktop app points this at a
// writable location (Electron's userData) via UPLOAD_DIR. A hardcoded backend/uploads made the AI
// evaluator read from the wrong directory in the desktop build, so every criterion looked
// document-less and was skipped. Keep this in sync with routes/submissions.ts.
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv']);

// PDFs larger than this are almost always high-resolution scans, whose raw base64 payload
// makes the vision call time out. We rasterize those to downscaled JPEGs (grades in seconds).
// Small PDFs stay on the native document path so their text layer is read directly.
const RASTERIZE_OVER_BYTES = 1_500_000;
const TARGET_PX = 1568;   // Claude downsamples images past this anyway
const JPEG_QUALITY = 80;

// mupdf is ESM-only (top-level await); load it via a real dynamic import that TypeScript's
// CommonJS output won't rewrite into require().
const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
let mupdfPromise: Promise<any> | null = null;
const loadMupdf = () => (mupdfPromise ??= dynamicImport('mupdf'));

// Render each PDF page to a downscaled JPEG (≤ TARGET_PX on the long edge).
async function rasterizePdf(data: Buffer): Promise<Buffer[]> {
    const mupdf = await loadMupdf();
    const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
    const pages: Buffer[] = [];
    for (let i = 0; i < doc.countPages(); i++) {
        const page = doc.loadPage(i);
        const b = page.getBounds();
        const scale = Math.min(TARGET_PX / Math.max(b[2] - b[0], b[3] - b[1]), 3);
        const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
        pages.push(Buffer.from(pixmap.asJPEG(JPEG_QUALITY)));
    }
    return pages;
}

// Build Anthropic content block(s) for one stored document ([] if unreadable here).
async function documentBlocks(doc: SubmissionDocument): Promise<Anthropic.ContentBlockParam[]> {
    if (doc.storage_provider !== 'local') return [];
    let data: Buffer;
    try {
        data = fs.readFileSync(path.join(uploadDir, doc.storage_path));
    } catch {
        return [];
    }
    const mime = doc.mime_type || '';
    if (mime === 'application/pdf') {
        if (data.length > RASTERIZE_OVER_BYTES) {
            try {
                const pages = await rasterizePdf(data);
                if (pages.length) return pages.map(p => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.toString('base64') } }));
            } catch { /* fall back to sending the raw PDF */ }
        }
        return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } }];
    }
    if (IMAGE_MIME.has(mime)) {
        return [{ type: 'image', source: { type: 'base64', media_type: mime as 'image/png', data: data.toString('base64') } }];
    }
    if (TEXT_MIME.has(mime)) {
        return [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: data.toString('utf8') } }];
    }
    return [];
}

interface CriterionResult {
    criterion_id: string;
    score?: number;      // 0..1 — checklist (no clauses) and percentage
    met?: boolean;       // binary
    checks?: boolean[];  // checklist with clauses — one boolean per clause, in order
    confidence: number;  // 0..1
    rationale: string;   // Arabic reasoning + citation
}

// A checklist criterion may define config.checks (clause texts) + config.scoring_mode.
function checklistClauses(c: IndicatorCriterion): string[] {
    const checks = c.config?.checks;
    return Array.isArray(checks) ? checks.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}
const checklistMode = (c: IndicatorCriterion): 'all' | 'fraction' => (c.config?.scoring_mode === 'all' ? 'all' : 'fraction');
function scoreChecklistChecks(checks: boolean[], mode: 'all' | 'fraction'): number {
    if (!checks.length) return 0;
    return mode === 'all' ? (checks.every(Boolean) ? 1 : 0) : checks.filter(Boolean).length / checks.length;
}

// Arabic description of the output the model must return for a criterion.
function outputSpec(c: IndicatorCriterion): string {
    const t = c.criterion_type;
    if (t === 'binary') return 'ثنائي — أعِد met=true إذا كان المعيار مستوفى وإلا met=false';
    if (t === 'checklist') {
        const clauses = checklistClauses(c);
        if (clauses.length) {
            return 'قائمة تحقق ذات بنود — قيّم كل بند مما يلي على حدة وأعِد checks كمصفوفة قيم منطقية (true/false) بنفس ترتيب البنود:\n'
                + clauses.map((x, i) => `   ${i + 1}) ${x}`).join('\n');
        }
        return 'قائمة تحقق — أعِد score بإحدى القيم فقط: 0 (غير مستوفٍ) أو 0.5 (مستوفٍ جزئياً) أو 1 (مستوفٍ بالكامل)';
    }
    return 'نسبة مئوية — أعِد score رقماً بين 0 و1 يعبّر عن نسبة الاستيفاء';
}

const snapChecklist = (v: number): number => [0, 0.5, 1].reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), 0);

// Coerce the model's answer into a 0..1 score plus any raw_values to persist (checklist checks).
function normalizeAiResult(c: IndicatorCriterion, r?: CriterionResult): { score: number; rawValues: Record<string, unknown> } {
    if (!r) return { score: 0, rawValues: {} };
    const t = c.criterion_type;
    if (t === 'binary') {
        if (typeof r.met === 'boolean') return { score: r.met ? 1 : 0, rawValues: {} };
        return { score: r.score != null && Number(r.score) >= 0.5 ? 1 : 0, rawValues: {} };
    }
    if (t === 'checklist') {
        const clauses = checklistClauses(c);
        if (clauses.length && Array.isArray(r.checks)) {
            const checks = clauses.map((_, i) => !!r.checks![i]);
            return { score: scoreChecklistChecks(checks, checklistMode(c)), rawValues: { checks } };
        }
        const s = Math.min(1, Math.max(0, Number(r.score ?? (r.met ? 1 : 0))));
        return { score: snapChecklist(s), rawValues: {} };
    }
    const s = Math.min(1, Math.max(0, Number(r.score ?? (r.met ? 1 : 0))));
    return { score: s, rawValues: {} };
}

export interface AiEvaluationResult {
    model: string;
    evaluated: Array<{ criterion_id: string; name_ar: string; score: number; confidence: number; rationale: string; raw_values: Record<string, unknown> }>;
    skipped: Array<{ criterion_id: string; name_ar: string; reason: string }>;
}

class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}

/**
 * Evaluate every criterion of one indicator for one department in one period.
 * Reads each criterion's submitted documents, makes a single Claude call, and
 * upserts an ai-method Evaluation per criterion (score 0..1 + rationale + confidence).
 */
export async function aiEvaluateIndicator(
    period_id: string, department_id: string, indicator_id: string, evaluatedBy: string,
): Promise<AiEvaluationResult> {
    const indicator = await Indicator.findByPk(indicator_id, {
        include: [{ model: IndicatorCriterion, as: 'criteria', where: { is_active: true }, required: false }],
    });
    if (!indicator) throw new HttpError(404, 'Indicator not found');
    const criteria = [...(indicator.criteria || [])].sort((a, b) => a.sort_order - b.sort_order);
    if (criteria.length === 0) throw new HttpError(400, 'Indicator has no criteria');

    const submissions = await Submission.findAll({
        where: { period_id, department_id, criterion_id: criteria.map(c => c.id) },
        include: [{ model: SubmissionDocument, as: 'documents' }],
    });
    const subByCriterion: Record<string, Submission> = {};
    submissions.forEach(s => { subByCriterion[s.criterion_id] = s; });

    // Who/when this evaluation is for — the (admin-editable) system prompt uses these so the
    // model can catch evidence that is valid in form but belongs to a different department or
    // a different (older) evaluation cycle.
    const [department, period, promptRow] = await Promise.all([
        Department.findByPk(department_id, { include: [{ model: College, as: 'college' }] }),
        EvaluationPeriod.findByPk(period_id),
        Setting.findByPk(SETTING_AI_EVAL_PROMPT),
    ]);
    const deptName = department?.name_ar || '(غير محدد)';
    const collegeName = department?.college?.name_ar;
    const periodLabel = period?.label_ar || (period ? `${period.month}/${period.year}` : '(غير محددة)');
    const systemPrompt = renderSystemPrompt(promptRow?.value || DEFAULT_AI_EVAL_SYSTEM_PROMPT, {
        department: deptName,
        college: collegeName || '—',
        period: periodLabel,
        indicator: indicator.name_ar,
        today: new Date().toISOString().slice(0, 10),
    });

    // Build the user message: each criterion's guidance + documents (the policy/provenance
    // instructions live in the system prompt above).
    const content: Anthropic.ContentBlockParam[] = [];
    const gradable: IndicatorCriterion[] = [];
    const skipped: AiEvaluationResult['skipped'] = [];

    for (const c of criteria) {
        // ratio criteria mix an AI count with a human-supplied denominator → entered manually
        if (c.criterion_type === 'ratio') {
            skipped.push({ criterion_id: c.id, name_ar: c.name_ar, reason: 'معيار نسبة — يُدخَل يدوياً' });
            continue;
        }
        const docs = subByCriterion[c.id]?.documents || [];
        const blocks = (await Promise.all(docs.map(documentBlocks))).flat();
        if (blocks.length === 0) {
            skipped.push({ criterion_id: c.id, name_ar: c.name_ar, reason: 'لا توجد مستندات قابلة للقراءة' });
            continue;
        }
        gradable.push(c);
        const guidance = (c.config?.ai_guidance as string | undefined)
            || `قيّم مدى استيفاء المعيار «${c.name_ar}» بالاعتماد على المستندات المرفقة.`;
        content.push({ type: 'text', text: `— المعيار (criterion_id: ${c.id}): ${c.name_ar}\nنوع التقييم: ${outputSpec(c)}\nتعليمات التقييم: ${guidance}\nالمستندات التالية تخص هذا المعيار:` });
        content.push(...blocks);
    }

    if (gradable.length === 0) {
        return { model: MODEL, evaluated: [], skipped };
    }

    content.push({
        type: 'text',
        text: 'قيّم كل معيار مما سبق على حدة اعتماداً على مستنداته ووفق «نوع التقييم» المحدد له: '
            + 'للمعيار الثنائي أعِد met (true/false)؛ ولمعيار قائمة التحقق ذي البنود أعِد checks (قيمة منطقية لكل بند بالترتيب)؛ '
            + 'ولمعيار قائمة التحقق بلا بنود أعِد score بإحدى القيم 0 أو 0.5 أو 1؛ ولمعيار النسبة المئوية أعِد score بين 0 و1. '
            + 'وأعِد لكل معيار درجة ثقة confidence بين 0 و1 وتبريراً موجزاً بالعربية يذكر اسم الملف والدليل. '
            + 'استخدم أداة record_scores وأعِد النتائج لكل criterion_id كما هو.',
    });

    // Bound the call: a normal grading request runs well under a minute, so a 2-min ceiling
    // with one retry fails fast instead of hanging on the SDK's 10-min default (and burning
    // tokens on its default retries). Heavy scanned PDFs can still exceed this — handled below.
    const client = new Anthropic({ timeout: 120_000, maxRetries: 1 }); // reads ANTHROPIC_API_KEY from env
    let response;
    try {
        response = await client.messages.create({
            model: MODEL,
            max_tokens: 4000,
            system: systemPrompt,
            tools: [{
                name: 'record_scores',
                description: 'Record the per-criterion assessment results.',
                input_schema: {
                    type: 'object',
                    properties: {
                        results: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    criterion_id: { type: 'string' },
                                    met: { type: 'boolean', description: 'binary criteria only: true if satisfied, false otherwise' },
                                    score: { type: 'number', description: '0..1 — checklist without clauses (use 0, 0.5, or 1) and percentage criteria' },
                                    checks: { type: 'array', items: { type: 'boolean' }, description: 'checklist criteria that list clauses: one boolean per clause, in the given order' },
                                    confidence: { type: 'number', description: '0..1' },
                                    rationale: { type: 'string' },
                                },
                                required: ['criterion_id', 'confidence', 'rationale'],
                            },
                        },
                    },
                    required: ['results'],
                },
            }],
            tool_choice: { type: 'tool', name: 'record_scores' },
            messages: [{ role: 'user', content }],
        });
    } catch (err) {
        const e = err as { name?: string; status?: number; message?: string };
        if (e?.name === 'APIConnectionTimeoutError' || /timed out/i.test(e?.message || '')) {
            throw new HttpError(504, 'انتهت مهلة التقييم الآلي — قد تكون المستندات كبيرة الحجم أو ممسوحة ضوئياً بدقة عالية. يُنصح بمراجعتها يدوياً أو رفع نسخ أصغر حجماً.');
        }
        throw new HttpError(e?.status || 502, `تعذّر الاتصال بخدمة التقييم: ${e?.message || 'خطأ غير معروف'}`);
    }

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) throw new HttpError(502, 'LLM did not return structured results');
    const results = ((toolUse.input as { results?: CriterionResult[] }).results) || [];
    const byId: Record<string, CriterionResult> = {};
    results.forEach(r => { byId[r.criterion_id] = r; });

    const evaluated: AiEvaluationResult['evaluated'] = [];
    for (const c of gradable) {
        const r = byId[c.id];
        const { score, rawValues } = normalizeAiResult(c, r);
        const confidence = r && r.confidence != null ? Math.min(1, Math.max(0, Number(r.confidence))) : null;
        const rationale = r?.rationale || 'لم يُرجِع النموذج نتيجة لهذا المعيار.';
        const submission = subByCriterion[c.id];

        const [evaluation, created] = await Evaluation.findOrCreate({
            where: { period_id, department_id, criterion_id: c.id },
            defaults: {
                period_id, department_id, criterion_id: c.id, submission_id: submission?.id ?? null,
                score, raw_values: rawValues, reviewer_notes: rationale, evaluation_method: 'ai',
                ai_confidence: confidence, ai_rationale: rationale, evaluated_by: evaluatedBy, evaluated_at: new Date(),
            },
        });
        if (!created) {
            await evaluation.update({
                submission_id: submission?.id ?? null, score, raw_values: rawValues, reviewer_notes: rationale, evaluation_method: 'ai',
                ai_confidence: confidence, ai_rationale: rationale, evaluated_by: evaluatedBy, evaluated_at: new Date(),
            });
        }
        if (submission) await submission.update({ status: 'reviewed' });
        evaluated.push({ criterion_id: c.id, name_ar: c.name_ar, score, confidence: confidence ?? 0, rationale, raw_values: rawValues });
    }

    return { model: MODEL, evaluated, skipped };
}
