// Unit tests for the pure model/effort config helpers (utils/aiConfig.ts) — no models / no SDK,
// so no mocks. They lock in that only whitelisted models and valid effort levels are accepted
// and that anything else (stale row, typo, empty, forced-tool-incompatible model) coerces to
// the safe default rather than reaching the API and 400-ing.

import {
    normalizeModel, normalizeEffort, isValidModel, isValidEffort,
    DEFAULT_AI_EVAL_MODEL, DEFAULT_AI_EVAL_EFFORT, AI_EVAL_MODELS, AI_EVAL_EFFORTS,
} from './aiConfig';

describe('model normalization', () => {
    it('keeps a whitelisted model', () => {
        expect(normalizeModel('claude-opus-5')).toBe('claude-opus-5');
        expect(normalizeModel('claude-opus-4-8')).toBe('claude-opus-4-8');
    });

    it('falls back to default for unknown / empty / null', () => {
        expect(normalizeModel('gpt-4')).toBe(DEFAULT_AI_EVAL_MODEL);
        expect(normalizeModel('')).toBe(DEFAULT_AI_EVAL_MODEL);
        expect(normalizeModel(null)).toBe(DEFAULT_AI_EVAL_MODEL);
        expect(normalizeModel(undefined)).toBe(DEFAULT_AI_EVAL_MODEL);
    });

    it('rejects models that break the evaluator (forced tool use / effort unsupported)', () => {
        // Fable → no forced tool use; Haiku → effort errors. Neither may be selectable.
        expect(isValidModel('claude-fable-5-1')).toBe(false);
        expect(isValidModel('claude-haiku-4-5')).toBe(false);
    });

    it('default is itself whitelisted', () => {
        expect(isValidModel(DEFAULT_AI_EVAL_MODEL)).toBe(true);
        expect(AI_EVAL_MODELS.some(m => m.id === DEFAULT_AI_EVAL_MODEL)).toBe(true);
    });
});

describe('effort normalization', () => {
    it('keeps a valid effort level', () => {
        expect(normalizeEffort('low')).toBe('low');
        expect(normalizeEffort('max')).toBe('max');
        expect(normalizeEffort('xhigh')).toBe('xhigh');
    });

    it('falls back to default for unknown / empty / null', () => {
        expect(normalizeEffort('turbo')).toBe(DEFAULT_AI_EVAL_EFFORT);
        expect(normalizeEffort('')).toBe(DEFAULT_AI_EVAL_EFFORT);
        expect(normalizeEffort(null)).toBe(DEFAULT_AI_EVAL_EFFORT);
        expect(normalizeEffort(undefined)).toBe(DEFAULT_AI_EVAL_EFFORT);
    });

    it('default is itself valid and the API no-op level', () => {
        expect(isValidEffort(DEFAULT_AI_EVAL_EFFORT)).toBe(true);
        expect(DEFAULT_AI_EVAL_EFFORT).toBe('high'); // 'high' == omitting effort, so default is behavior-neutral
        expect(AI_EVAL_EFFORTS.some(e => e.id === DEFAULT_AI_EVAL_EFFORT)).toBe(true);
    });
});
