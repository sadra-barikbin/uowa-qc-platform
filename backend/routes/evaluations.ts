import { Router, Request, Response } from 'express';
import {
    Evaluation, IndicatorCriterion, Indicator, Submission, SubmissionDocument,
    EvaluationPeriod, PeriodIndicator, Department, User, EvaluationMethod,
} from '../models';
import { authenticate, authorize } from '../middleware/auth';
import { getIndicatorScores, getDepartmentScores, getCollegeScores } from '../utils/scores';
import { aiEvaluateIndicator } from '../utils/aiEvaluator';
import { gatePeriod, EVALUATION_STATES } from '../utils/periodGuard';
import { startAiJob, getAiJob, getLatestAiJob } from '../utils/aiJobs';

// score a 'ratio' criterion from raw numbers, capped at 1
function computeRatioScore(raw_values: { numerator?: number; denominator?: number } | undefined): number | null {
    const num = Number(raw_values?.numerator);
    const den = Number(raw_values?.denominator);
    if (!den || Number.isNaN(num) || Number.isNaN(den)) return null;
    return Math.min(num / den, 1);
}

const router = Router();

// GET /api/evaluations?period_id=&department_id=
router.get('/', authenticate, authorize('admin', 'qc_head'), async (req: Request, res: Response) => {
    const { period_id, department_id, criterion_id } = req.query as Record<string, string | undefined>;
    const where: Record<string, string> = {};
    if (period_id) where.period_id = period_id;
    if (department_id) where.department_id = department_id;
    if (criterion_id) where.criterion_id = criterion_id;

    const evaluations = await Evaluation.findAll({
        where,
        include: [
            { model: IndicatorCriterion, as: 'criterion', include: [{ model: Indicator, as: 'indicator' }] },
            { model: Department, as: 'department', attributes: ['id', 'name_ar', 'name_en'] },
            { model: User, as: 'evaluator', attributes: ['id', 'full_name', 'full_name_ar'] },
        ],
        order: [['updatedAt', 'DESC']],
    });
    res.json({ evaluations });
});

// GET /api/evaluations/matrix?period_id=&department_id= — every criterion for a department in
// a period, merged with its submission evidence and current evaluation (reviewer-facing)
router.get('/matrix', authenticate, authorize('admin', 'qc_head'), async (req: Request, res: Response) => {
    const { period_id, department_id } = req.query as Record<string, string | undefined>;
    if (!period_id || !department_id) return res.status(400).json({ error: 'period_id and department_id are required' });

    const period = await EvaluationPeriod.findByPk(period_id, {
        include: [{
            model: PeriodIndicator, as: 'period_indicators', where: { is_active: true }, required: false,
            include: [{ model: Indicator, as: 'indicator', include: [{ model: IndicatorCriterion, as: 'criteria', where: { is_active: true }, required: false }] }],
        }],
    });
    if (!period) return res.status(404).json({ error: 'Period not found' });

    const [submissions, evaluations] = await Promise.all([
        Submission.findAll({ where: { period_id, department_id }, include: [{ model: SubmissionDocument, as: 'documents' }] }),
        Evaluation.findAll({ where: { period_id, department_id } }),
    ]);
    const subByCriterion: Record<string, Submission> = {};
    submissions.forEach(s => { subByCriterion[s.criterion_id] = s; });
    const evalByCriterion: Record<string, Evaluation> = {};
    evaluations.forEach(e => { evalByCriterion[e.criterion_id] = e; });

    const matrix = (period.period_indicators || []).map(pi => ({
        indicator: { id: pi.indicator!.id, code: pi.indicator!.code, name_ar: pi.indicator!.name_ar, name_en: pi.indicator!.name_en, weight: pi.weight },
        criteria: (pi.indicator!.criteria || []).map(c => ({
            criterion: c,
            submission: subByCriterion[c.id] || null,
            evaluation: evalByCriterion[c.id] || null,
        })),
    }));

    res.json({ period, matrix });
});

// POST /api/evaluations — upsert a reviewer (or AI) score for a dept/period/criterion
router.post('/', authenticate, authorize('admin', 'qc_head'), async (req: Request, res: Response) => {
    const { period_id, department_id, criterion_id, submission_id, score, raw_values, reviewer_notes, evaluation_method } = req.body as {
        period_id: string; department_id: string; criterion_id: string; submission_id?: string;
        score?: number; raw_values?: { numerator?: number; denominator?: number }; reviewer_notes?: string; evaluation_method?: EvaluationMethod;
    };
    if (!period_id || !department_id || !criterion_id) {
        return res.status(400).json({ error: 'period_id, department_id, criterion_id are required' });
    }
    const gate = await gatePeriod(period_id, EVALUATION_STATES, 'evaluation');
    if (!gate.ok) return res.status(gate.code).json({ error: gate.error });

    const criterion = await IndicatorCriterion.findByPk(criterion_id);
    if (!criterion) return res.status(404).json({ error: 'Criterion not found' });

    let finalScore: number | null | undefined = score;
    if (criterion.criterion_type === 'ratio' && raw_values) {
        finalScore = computeRatioScore(raw_values);
        if (finalScore === null) return res.status(400).json({ error: 'raw_values.numerator and raw_values.denominator are required for ratio criteria' });
    }
    if (finalScore == null || Number.isNaN(Number(finalScore))) return res.status(400).json({ error: 'score (or raw_values for ratio criteria) is required' });
    finalScore = Math.min(1, Math.max(0, Number(finalScore))); // binary / checklist / percentage all normalize to 0..1

    const [evaluation, created] = await Evaluation.findOrCreate({
        where: { period_id, department_id, criterion_id },
        defaults: {
            period_id, department_id, criterion_id,
            submission_id: submission_id ?? null, score: finalScore, raw_values: raw_values || {}, reviewer_notes: reviewer_notes ?? null,
            evaluation_method: evaluation_method || 'manual', evaluated_by: req.user!.id, evaluated_at: new Date(),
        },
    });
    if (!created) {
        await evaluation.update({
            submission_id: submission_id ?? null, score: finalScore, raw_values: raw_values || {}, reviewer_notes: reviewer_notes ?? null,
            evaluation_method: evaluation_method || 'manual', evaluated_by: req.user!.id, evaluated_at: new Date(),
        });
    }
    if (submission_id) await Submission.update({ status: 'reviewed' }, { where: { id: submission_id } });

    res.status(created ? 201 : 200).json({ evaluation });
});

// POST /api/evaluations/ai — run the LLM assessor for one indicator of a department in a period
router.post('/ai', authenticate, authorize('admin', 'qc_head'), async (req: Request, res: Response) => {
    const { period_id, department_id, indicator_id } = req.body as { period_id?: string; department_id?: string; indicator_id?: string };
    if (!period_id || !department_id || !indicator_id) {
        return res.status(400).json({ error: 'period_id, department_id, indicator_id are required' });
    }
    const gate = await gatePeriod(period_id, EVALUATION_STATES, 'evaluation');
    if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
    try {
        const result = await aiEvaluateIndicator(period_id, department_id, indicator_id, req.user!.id);
        res.json(result);
    } catch (err) {
        const status = (err as { status?: number }).status || 500;
        res.status(status).json({ error: (err as Error).message });
    }
});

// ── Background AI-evaluation jobs ─────────────────────────────
// The server orchestrates the per-indicator loop and the UI observes it, so a run
// survives page navigation / minimize instead of dying with the page's JS.

// POST /api/evaluations/ai/jobs — start a background job for one or more indicators
// ({ indicator_ids } omitted → every active indicator for the period).
router.post('/ai/jobs', authenticate, authorize('admin', 'qc_head'), async (req: Request, res: Response) => {
    const { period_id, department_id, indicator_ids } = req.body as {
        period_id?: string; department_id?: string; indicator_ids?: string[];
    };
    if (!period_id || !department_id) {
        return res.status(400).json({ error: 'period_id and department_id are required' });
    }
    const gate = await gatePeriod(period_id, EVALUATION_STATES, 'evaluation');
    if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
    try {
        const job = await startAiJob({ period_id, department_id, indicator_ids, evaluatedBy: req.user!.id });
        res.status(201).json({ job });
    } catch (err) {
        const status = (err as { status?: number }).status || 500;
        res.status(status).json({ error: (err as Error).message });
    }
});

// GET /api/evaluations/ai/jobs/active?period_id=&department_id= — the latest job for a
// department (running or recently finished), so the page can reconnect after navigating away.
// Registered before /ai/jobs/:id so 'active' isn't captured as an id.
router.get('/ai/jobs/active', authenticate, authorize('admin', 'qc_head'), (req: Request, res: Response) => {
    const { period_id, department_id } = req.query as Record<string, string | undefined>;
    if (!period_id || !department_id) return res.status(400).json({ error: 'period_id and department_id are required' });
    res.json({ job: getLatestAiJob(period_id, department_id) || null });
});

// GET /api/evaluations/ai/jobs/:id — poll one job's progress
router.get('/ai/jobs/:id', authenticate, authorize('admin', 'qc_head'), (req: Request, res: Response) => {
    const job = getAiJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
});

// GET /api/evaluations/scores/indicators?period_id=&department_id=
router.get('/scores/indicators', authenticate, async (req: Request, res: Response) => {
    const { period_id, department_id } = req.query as Record<string, string | undefined>;
    if (!period_id) return res.status(400).json({ error: 'period_id is required' });
    res.json({ scores: await getIndicatorScores(period_id, department_id || null) });
});

// GET /api/evaluations/scores/departments?period_id=
router.get('/scores/departments', authenticate, async (req: Request, res: Response) => {
    const { period_id } = req.query as Record<string, string | undefined>;
    if (!period_id) return res.status(400).json({ error: 'period_id is required' });
    res.json({ scores: await getDepartmentScores(period_id) });
});

// GET /api/evaluations/scores/colleges?period_id=
router.get('/scores/colleges', authenticate, async (req: Request, res: Response) => {
    const { period_id } = req.query as Record<string, string | undefined>;
    if (!period_id) return res.status(400).json({ error: 'period_id is required' });
    res.json({ scores: await getCollegeScores(period_id) });
});

export default router;
