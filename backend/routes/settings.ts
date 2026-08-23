import { Router, Request, Response } from 'express';
import { Setting } from '../models';
import { authenticate, authorize } from '../middleware/auth';
import { SETTING_AI_EVAL_PROMPT, DEFAULT_AI_EVAL_SYSTEM_PROMPT, AI_PROMPT_VARIABLES } from '../utils/aiPrompt';

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

export default router;
