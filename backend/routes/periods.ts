import { Router, Request, Response } from 'express';
import { InferCreationAttributes } from 'sequelize';
import { EvaluationPeriod, PeriodIndicator, Indicator, IndicatorCriterion } from '../models';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET /api/periods
router.get('/', authenticate, async (req: Request, res: Response) => {
    const periods = await EvaluationPeriod.findAll({ order: [['year', 'DESC'], ['month', 'DESC']] });
    res.json({ periods });
});

// GET /api/periods/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
    const period = await EvaluationPeriod.findByPk(req.params.id, {
        include: [{
            model: PeriodIndicator, as: 'period_indicators', where: { is_active: true }, required: false,
            include: [{ model: Indicator, as: 'indicator', include: [{ model: IndicatorCriterion, as: 'criteria', where: { is_active: true }, required: false }] }],
        }],
        order: [[{ model: PeriodIndicator, as: 'period_indicators' }, 'sort_order', 'ASC']],
    });
    if (!period) return res.status(404).json({ error: 'Period not found' });
    res.json({ period });
});

// POST /api/periods — create a new evaluation period, optionally cloning the indicator
// set (and weights) from a previous period so you don't have to rebuild it every month
router.post('/', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { year, month, label_en, label_ar, submission_deadline, clone_from_period_id } = req.body;
    if (!year || !month) return res.status(400).json({ error: 'year and month are required' });

    const period = await EvaluationPeriod.create({
        // An empty deadline from the form arrives as '' — coerce to null so Postgres doesn't
        // get "Invalid date" for the timestamp column.
        year, month, label_en, label_ar, submission_deadline: submission_deadline || null, created_by: req.user!.id,
    });

    if (clone_from_period_id) {
        const sourceIndicators = await PeriodIndicator.findAll({ where: { period_id: clone_from_period_id, is_active: true } });
        await PeriodIndicator.bulkCreate(sourceIndicators.map(pi => ({
            period_id: period.id, indicator_id: pi.indicator_id, weight: pi.weight, sort_order: pi.sort_order,
        })));
    } else {
        const indicators = await Indicator.findAll({ where: { is_active: true }, order: [['sort_order', 'ASC']] });
        await PeriodIndicator.bulkCreate(indicators.map((ind, i) => ({
            period_id: period.id, indicator_id: ind.id, weight: 1.0, sort_order: i,
        })));
    }

    res.status(201).json({ period });
});

// PUT /api/periods/:id
router.put('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const period = await EvaluationPeriod.findByPk(req.params.id);
    if (!period) return res.status(404).json({ error: 'Period not found' });
    // Only touch fields actually present in the body: some callers send a status-only update
    // (e.g. changing the period's status), and unconditionally writing the others would wipe
    // them. An empty deadline ('') is normalised to null to avoid an invalid-timestamp error.
    const { label_en, label_ar, submission_deadline, status } = req.body;
    const updates: Partial<InferCreationAttributes<EvaluationPeriod>> = {};
    if (label_en !== undefined) updates.label_en = label_en;
    if (label_ar !== undefined) updates.label_ar = label_ar;
    if (submission_deadline !== undefined) updates.submission_deadline = submission_deadline || null;
    if (status !== undefined) updates.status = status;
    await period.update(updates);
    res.json({ period });
});

// PUT /api/periods/:id/indicators — set which indicators apply to this period and their weight
router.put('/:id/indicators', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { indicators } = req.body as { indicators: Array<{ indicator_id: string; weight?: number; sort_order?: number; is_active?: boolean }> };
    if (!Array.isArray(indicators)) return res.status(400).json({ error: 'indicators must be an array' });

    await Promise.all(indicators.map(({ indicator_id, weight, sort_order, is_active }) =>
        PeriodIndicator.upsert({
            period_id: req.params.id, indicator_id, weight: weight ?? 1.0,
            sort_order: sort_order ?? 0, is_active: is_active ?? true,
        }, { conflictFields: ['period_id', 'indicator_id'] as any })
    ));

    const period_indicators = await PeriodIndicator.findAll({ where: { period_id: req.params.id } });
    res.json({ period_indicators });
});

export default router;
