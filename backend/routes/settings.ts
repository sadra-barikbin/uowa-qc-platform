import { Router, Request, Response } from 'express';
import { Setting } from '../models';
import { authenticate, authorize } from '../middleware/auth';
import { SETTING_AI_EVAL_PROMPT, DEFAULT_AI_EVAL_SYSTEM_PROMPT, AI_PROMPT_VARIABLES } from '../utils/aiPrompt';
import {
    SETTING_AI_EVAL_MODEL, SETTING_AI_EVAL_EFFORT,
    DEFAULT_AI_EVAL_MODEL, DEFAULT_AI_EVAL_EFFORT,
    AI_EVAL_MODELS, AI_EVAL_EFFORTS, isValidModel, isValidEffort,
} from '../utils/aiConfig';

const router = Router();

// GET /api/settings/ai-eval-prompt — the active template (custom or default), plus the default + variables
router.get('/ai-eval-prompt', authenticate, authorize('admin'), async (_req: Request, res: Response) => {
    const row = await Setting.findByPk(SETTING_AI_EVAL_PROMPT);
    res.json({
        value: row?.value ?? DEFAULT_AI_EVAL_SYSTEM_PROMPT,
        is_default: !row,
        default: DEFAULT_AI_EVAL_SYSTEM_PROMPT,
        variables: AI_PROMPT_VARIABLES,
    });
});

// PUT /api/settings/ai-eval-prompt — save a custom template
router.put('/ai-eval-prompt', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { value } = req.body as { value?: string };
    if (!value || !value.trim()) return res.status(400).json({ error: 'value is required' });
    await Setting.upsert({ key: SETTING_AI_EVAL_PROMPT, value: value.trim(), updated_by: req.user!.id });
    res.json({ value: value.trim(), is_default: false });
});

// DELETE /api/settings/ai-eval-prompt — reset to the built-in default
router.delete('/ai-eval-prompt', authenticate, authorize('admin'), async (_req: Request, res: Response) => {
    await Setting.destroy({ where: { key: SETTING_AI_EVAL_PROMPT } });
    res.json({ value: DEFAULT_AI_EVAL_SYSTEM_PROMPT, is_default: true });
});

// GET /api/settings/ai-eval-config — active model + reasoning effort (custom or default), plus
// the selectable options and defaults for the settings UI.
router.get('/ai-eval-config', authenticate, authorize('admin'), async (_req: Request, res: Response) => {
    const [modelRow, effortRow] = await Promise.all([
        Setting.findByPk(SETTING_AI_EVAL_MODEL),
        Setting.findByPk(SETTING_AI_EVAL_EFFORT),
    ]);
    // Reflect the same fallback the evaluator applies, so the UI shows what actually runs.
    const model = isValidModel(modelRow?.value) ? modelRow!.value : DEFAULT_AI_EVAL_MODEL;
    const effort = isValidEffort(effortRow?.value) ? effortRow!.value : DEFAULT_AI_EVAL_EFFORT;
    res.json({
        model, effort,
        model_is_default: !modelRow,
        effort_is_default: !effortRow,
        default_model: DEFAULT_AI_EVAL_MODEL,
        default_effort: DEFAULT_AI_EVAL_EFFORT,
        models: AI_EVAL_MODELS,
        efforts: AI_EVAL_EFFORTS,
    });
});

// PUT /api/settings/ai-eval-config — save the chosen model and/or effort (each optional).
router.put('/ai-eval-config', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { model, effort } = req.body as { model?: string; effort?: string };
    if (model === undefined && effort === undefined) return res.status(400).json({ error: 'model or effort is required' });
    if (model !== undefined && !isValidModel(model)) return res.status(400).json({ error: 'نموذج غير مدعوم' });
    if (effort !== undefined && !isValidEffort(effort)) return res.status(400).json({ error: 'مستوى تفكير غير صالح' });
    if (model !== undefined) await Setting.upsert({ key: SETTING_AI_EVAL_MODEL, value: model, updated_by: req.user!.id });
    if (effort !== undefined) await Setting.upsert({ key: SETTING_AI_EVAL_EFFORT, value: effort, updated_by: req.user!.id });
    res.json({
        model: isValidModel(model) ? model : undefined,
        effort: isValidEffort(effort) ? effort : undefined,
        model_is_default: false,
        effort_is_default: false,
    });
});

export default router;
