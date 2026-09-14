import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
    Indicator, IndicatorCriterion, Submission, SubmissionDocument, Evaluation,
    Department, College, EvaluationPeriod, Setting,
} from '../models';
import { SETTING_AI_EVAL_PROMPT, DEFAULT_AI_EVAL_SYSTEM_PROMPT, renderSystemPrompt } from './aiPrompt';
import { CriterionResult, finalCriterionScore, isDepartmentMismatch } from './aiScore';

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

// Arabic description of the output the model must return for a given criterion type.
function outputSpec(type: string): string {
    if (type === 'binary') return 'ثنائي — أعِد met=true إذا كان المعيار مستوفى وإلا met=false';
    if (type === 'checklist') return 'قائمة تحقق — أعِد score بإحدى القيم فقط: 0 (غير مستوفٍ) أو 0.5 (مستوفٍ جزئياً) أو 1 (مستوفٍ بالكامل)';
    return 'نسبة مئوية — أعِد score رقماً بين 0 و1 يعبّر عن نسبة الاستيفاء';
}

export interface AiEvaluationResult {
    model: string;
    evaluated: Array<{ criterion_id: string; name_ar: string; score: number; confidence: number; rationale: string }>;
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
        content.push({ type: 'text', text: `— المعيار (criterion_id: ${c.id}): ${c.name_ar}\nنوع التقييم: ${outputSpec(c.criterion_type)}\nتعليمات التقييم: ${guidance}\nالمستندات التالية تخص هذا المعيار:` });
        content.push(...blocks);
    }

    if (gradable.length === 0) {
        return { model: MODEL, evaluated: [], skipped };
    }

    content.push({
        type: 'text',
        text: 'قيّم كل معيار مما سبق على حدة اعتماداً على مستنداته ووفق «نوع التقييم» المحدد له: '
            + 'للمعيار الثنائي أعِد met (true/false)، ولمعيار قائمة التحقق أعِد score بإحدى القيم 0 أو 0.5 أو 1، '
            + 'ولمعيار النسبة المئوية أعِد score رقماً بين 0 و1. وأعِد لكل معيار درجة ثقة confidence بين 0 و1 '
            + 'وتبريراً موجزاً بالعربية يذكر اسم الملف والدليل. '
            + 'وأعِد أيضاً لكل معيار الحقل department_match الذي يبيّن انتماء مستنداته للقسم المُقيَّم المذكور في تعليمات النظام: '
            + '"match" إذا كانت تعود لهذا القسم بعينه، و"mismatch" إذا كانت تعود بوضوح لقسمٍ آخر ولو كان شقيقاً في الكلية نفسها، '
            + 'و"not_stated" إذا لم تُحدِّد المستنداتُ القسمَ. استخدم أداة record_scores وأعِد النتائج لكل criterion_id كما هو.',
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
                                    score: { type: 'number', description: '0..1 — checklist (use 0, 0.5, or 1) and percentage criteria' },
                                    confidence: { type: 'number', description: '0..1' },
                                    rationale: { type: 'string' },
                                    department_match: {
                                        type: 'string',
                                        enum: ['match', 'mismatch', 'not_stated'],
                                        description: 'Whether the evidence belongs to the exact department being evaluated (named in the system prompt): "match" = this department; "mismatch" = clearly a different department, even a sibling in the same college; "not_stated" = the documents do not identify a department.',
                                    },
                                },
                                required: ['criterion_id', 'confidence', 'rationale', 'department_match'],
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
        const score = finalCriterionScore(c.criterion_type, r);
        const confidence = r && r.confidence != null ? Math.min(1, Math.max(0, Number(r.confidence))) : null;
        // Surface the deterministic provenance gate in the reviewer-visible rationale, so a forced
        // zero is explained rather than looking like the model simply scored it 0.
        const baseRationale = r?.rationale || 'لم يُرجِع النموذج نتيجة لهذا المعيار.';
        const rationale = isDepartmentMismatch(r)
            ? `⚠️ تم ضبط الدرجة إلى صفر آلياً: الدليل يعود لقسمٍ آخر غير «${deptName}». ${baseRationale}`
            : baseRationale;
        const submission = subByCriterion[c.id];

        const [evaluation, created] = await Evaluation.findOrCreate({
            where: { period_id, department_id, criterion_id: c.id },
            defaults: {
                period_id, department_id, criterion_id: c.id, submission_id: submission?.id ?? null,
                score, reviewer_notes: rationale, evaluation_method: 'ai',
                ai_confidence: confidence, ai_rationale: rationale, evaluated_by: evaluatedBy, evaluated_at: new Date(),
            },
        });
        if (!created) {
            await evaluation.update({
                submission_id: submission?.id ?? null, score, reviewer_notes: rationale, evaluation_method: 'ai',
                ai_confidence: confidence, ai_rationale: rationale, evaluated_by: evaluatedBy, evaluated_at: new Date(),
            });
        }
        if (submission) await submission.update({ status: 'reviewed' });
        evaluated.push({ criterion_id: c.id, name_ar: c.name_ar, score, confidence: confidence ?? 0, rationale });
    }

    return { model: MODEL, evaluated, skipped };
}
