import { Router, Request, Response } from 'express';
import { Indicator, IndicatorCriterion, CriterionType } from '../models';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET /api/indicators
router.get('/', authenticate, async (req: Request, res: Response) => {
    const indicators = await Indicator.findAll({
        where: { is_active: true },
        include: [{ model: IndicatorCriterion, as: 'criteria', where: { is_active: true }, required: false }],
        order: [['sort_order', 'ASC'], [{ model: IndicatorCriterion, as: 'criteria' }, 'sort_order', 'ASC']],
    });
    res.json({ indicators });
});

// GET /api/indicators/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
    const indicator = await Indicator.findByPk(req.params.id, {
        include: [{ model: IndicatorCriterion, as: 'criteria' }],
    });
    if (!indicator) return res.status(404).json({ error: 'Indicator not found' });
    res.json({ indicator });
});

interface CriterionInput {
    code?: string;
    name_en?: string;
    name_ar: string;
    description_en?: string;
    description_ar?: string;
    criterion_type?: CriterionType;
    weight?: number;
    config?: Record<string, unknown>;
    requires_evidence?: boolean;
}

// POST /api/indicators — create a new indicator, optionally with its criteria
router.post('/', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { code, name_en, name_ar, description_en, description_ar, sort_order, criteria } = req.body as {
        code: string; name_en?: string; name_ar: string; description_en?: string; description_ar?: string;
        sort_order?: number; criteria?: CriterionInput[];
    };
    if (!code || !name_ar) return res.status(400).json({ error: 'code and name_ar are required' });

    const indicator = await Indicator.create({
        code, name_en: name_en || name_ar, name_ar, description_en: description_en ?? null, description_ar: description_ar ?? null,
        sort_order: sort_order ?? 0, created_by: req.user!.id,
    });

    if (Array.isArray(criteria) && criteria.length) {
        await IndicatorCriterion.bulkCreate(criteria.map((c, i) => ({
            indicator_id: indicator.id,
            code: c.code || `c${i + 1}`,
            name_en: c.name_en || c.name_ar,
            name_ar: c.name_ar,
            description_en: c.description_en ?? null,
            description_ar: c.description_ar ?? null,
            criterion_type: c.criterion_type || 'checklist',
            weight: c.weight ?? 1.0,
            config: c.config || {},
            requires_evidence: c.requires_evidence ?? true,
            sort_order: i,
        })));
    }

    const full = await Indicator.findByPk(indicator.id, { include: [{ model: IndicatorCriterion, as: 'criteria' }] });
    res.status(201).json({ indicator: full });
});

// PUT /api/indicators/:id
router.put('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const indicator = await Indicator.findByPk(req.params.id);
    if (!indicator) return res.status(404).json({ error: 'Indicator not found' });
    const { name_en, name_ar, description_en, description_ar, sort_order, is_active } = req.body;
    await indicator.update({ name_en, name_ar, description_en, description_ar, sort_order, is_active });
    res.json({ indicator });
});

// DELETE /api/indicators/:id — soft delete
router.delete('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const indicator = await Indicator.findByPk(req.params.id);
    if (!indicator) return res.status(404).json({ error: 'Indicator not found' });
    await indicator.update({ is_active: false });
    res.json({ message: 'Indicator deactivated' });
});

// POST /api/indicators/:id/criteria — add a criterion to an existing indicator
router.post('/:id/criteria', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { code, name_en, name_ar, description_en, description_ar, criterion_type, weight, config, requires_evidence, sort_order } = req.body;
    if (!code || !name_ar) return res.status(400).json({ error: 'code and name_ar are required' });

    const criterion = await IndicatorCriterion.create({
        indicator_id: req.params.id, code, name_en: name_en || name_ar, name_ar,
        description_en, description_ar, criterion_type: criterion_type || 'checklist',
        weight: weight ?? 1.0, config: config || {}, requires_evidence: requires_evidence ?? true, sort_order: sort_order ?? 0,
    });
    res.status(201).json({ criterion });
});

// PUT /api/indicators/criteria/:criterionId
router.put('/criteria/:criterionId', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const criterion = await IndicatorCriterion.findByPk(req.params.criterionId);
    if (!criterion) return res.status(404).json({ error: 'Criterion not found' });
    const { name_en, name_ar, description_en, description_ar, criterion_type, weight, config, requires_evidence, sort_order, is_active } = req.body;
    await criterion.update({ name_en, name_ar, description_en, description_ar, criterion_type, weight, config, requires_evidence, sort_order, is_active });
    res.json({ criterion });
});

export default router;
