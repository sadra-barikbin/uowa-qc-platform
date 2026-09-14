// Admin-selectable model + reasoning-effort for the AI assessor. Like the system prompt
// (aiPrompt.ts), the chosen values are persisted as `settings` rows and fall back to a
// built-in default when unset. The pure normalize* helpers below (no models / no SDK) are
// unit-tested in aiConfig.test.ts.

export const SETTING_AI_EVAL_MODEL = 'ai_eval_model';
export const SETTING_AI_EVAL_EFFORT = 'ai_eval_effort';

// Only models that support BOTH forced tool use (the evaluator pins
// tool_choice: {type:'tool', name:'record_scores'}) AND output_config.effort. That rules out
// the Fable family (forced tool use returns 400) and Haiku 4.5 (effort returns an error). All
// three below run adaptive thinking, so effort meaningfully controls reasoning depth.
export interface AiModelOption { id: string; label_ar: string }
export const AI_EVAL_MODELS: AiModelOption[] = [
    { id: 'claude-sonnet-5', label_ar: 'كلود سونيت 5 — الأسرع والأوفر (افتراضي)' },
    { id: 'claude-opus-5', label_ar: 'كلود أوبَس 5 — الأقوى' },
    { id: 'claude-opus-4-8', label_ar: 'كلود أوبَس 4.8' },
];
export const DEFAULT_AI_EVAL_MODEL = 'claude-sonnet-5';

// output_config.effort levels, low→max. 'high' is the API default, so it keeps today's behavior.
export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface AiEffortOption { id: AiEffort; label_ar: string }
export const AI_EVAL_EFFORTS: AiEffortOption[] = [
    { id: 'low', label_ar: 'منخفض — أسرع وأوفر' },
    { id: 'medium', label_ar: 'متوسط' },
    { id: 'high', label_ar: 'عالٍ (افتراضي)' },
    { id: 'xhigh', label_ar: 'عالٍ جداً' },
    { id: 'max', label_ar: 'الأقصى — أدق وأبطأ' },
];
export const DEFAULT_AI_EVAL_EFFORT: AiEffort = 'high';

const MODEL_IDS = new Set(AI_EVAL_MODELS.map(m => m.id));
const EFFORT_IDS = new Set<string>(AI_EVAL_EFFORTS.map(e => e.id));

export const isValidModel = (v?: string | null): boolean => !!v && MODEL_IDS.has(v);
export const isValidEffort = (v?: string | null): v is AiEffort => !!v && EFFORT_IDS.has(v);

// Coerce a stored/candidate value into an allowed model; unknown/empty → default.
export const normalizeModel = (v?: string | null): string => (isValidModel(v) ? v! : DEFAULT_AI_EVAL_MODEL);
// Coerce a stored/candidate value into an allowed effort; unknown/empty → default.
export const normalizeEffort = (v?: string | null): AiEffort => (isValidEffort(v) ? v : DEFAULT_AI_EVAL_EFFORT);
