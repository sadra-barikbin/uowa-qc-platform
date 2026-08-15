import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
    Indicator, IndicatorCriterion, Submission, SubmissionDocument, Evaluation,
} from '../models';

// Default to Sonnet 5 (fast, reads Arabic + PDFs well); override via env to escalate to Opus.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const uploadDir = path.join(__dirname, '../uploads');

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv']);

// Build an Anthropic content block for one stored document, or null if unreadable here.
function documentBlock(doc: SubmissionDocument): Anthropic.ContentBlockParam | null {
    if (doc.storage_provider !== 'local') return null;
    let data: Buffer;
    try {
        data = fs.readFileSync(path.join(uploadDir, doc.storage_path));
    } catch {
        return null;
    }
    const mime = doc.mime_type || '';
    if (mime === 'application/pdf') {
        return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } };
    }
    if (IMAGE_MIME.has(mime)) {
        return { type: 'image', source: { type: 'base64', media_type: mime as 'image/png', data: data.toString('base64') } };
    }
    if (TEXT_MIME.has(mime)) {
        return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: data.toString('utf8') } };
    }
    return null;
}

interface CriterionResult {
    criterion_id: string;
    score: number;       // 0..1
    confidence: number;  // 0..1
    rationale: string;   // Arabic reasoning + citation
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

    // Build the message: for each criterion, its guidance + attached documents.
    const content: Anthropic.ContentBlockParam[] = [];
    const gradable: IndicatorCriterion[] = [];
    const skipped: AiEvaluationResult['skipped'] = [];

    for (const c of criteria) {
        const docs = subByCriterion[c.id]?.documents || [];
        const blocks = docs.map(documentBlock).filter((b): b is Anthropic.ContentBlockParam => b !== null);
        if (blocks.length === 0) {
            skipped.push({ criterion_id: c.id, name_ar: c.name_ar, reason: 'لا توجد مستندات قابلة للقراءة' });
            continue;
        }
        gradable.push(c);
        const guidance = (c.config?.ai_guidance as string | undefined)
            || `قيّم مدى استيفاء المعيار «${c.name_ar}» بالاعتماد على المستندات المرفقة. النوع: ${c.criterion_type}.`;
        content.push({ type: 'text', text: `— المعيار (criterion_id: ${c.id}): ${c.name_ar}\nتعليمات التقييم: ${guidance}\nالمستندات التالية تخص هذا المعيار:` });
        content.push(...blocks);
    }

    if (gradable.length === 0) {
        return { model: MODEL, evaluated: [], skipped };
    }

    content.push({
        type: 'text',
        text: 'قيّم كل معيار مما سبق على حدة اعتماداً على مستنداته. أعِد لكل معيار درجة score بين 0 و1 '
            + '(1 = مستوفٍ بالكامل، 0 = غير مستوفٍ)، ودرجة ثقة confidence بين 0 و1، وتبريراً موجزاً بالعربية '
            + 'يذكر اسم الملف والدليل. استخدم أداة record_scores وأعِد النتائج لكل criterion_id كما هو.',
    });

    // Bound the call: a single grading request runs ~30s, so a 2-min ceiling with one
    // retry fails fast on a stalled connection instead of hanging on the SDK's 10-min default.
    const client = new Anthropic({ timeout: 120_000, maxRetries: 1 }); // reads ANTHROPIC_API_KEY from env
    const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
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
                                score: { type: 'number', description: '0..1' },
                                confidence: { type: 'number', description: '0..1' },
                                rationale: { type: 'string' },
                            },
                            required: ['criterion_id', 'score', 'confidence', 'rationale'],
                        },
                    },
                },
                required: ['results'],
            },
        }],
        tool_choice: { type: 'tool', name: 'record_scores' },
        messages: [{ role: 'user', content }],
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) throw new HttpError(502, 'LLM did not return structured results');
    const results = ((toolUse.input as { results?: CriterionResult[] }).results) || [];
    const byId: Record<string, CriterionResult> = {};
    results.forEach(r => { byId[r.criterion_id] = r; });

    const evaluated: AiEvaluationResult['evaluated'] = [];
    for (const c of gradable) {
        const r = byId[c.id];
        const score = r ? Math.min(1, Math.max(0, Number(r.score))) : 0;
        const confidence = r && r.confidence != null ? Math.min(1, Math.max(0, Number(r.confidence))) : null;
        const rationale = r?.rationale || 'لم يُرجِع النموذج نتيجة لهذا المعيار.';
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
