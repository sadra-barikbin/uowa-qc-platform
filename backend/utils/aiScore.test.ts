// Unit tests for the pure AI-assessor scoring helpers (utils/aiScore.ts). No models / no SDK,
// so no mocks: these lock in the score coercion per criterion type and — the point of the
// change — that an explicit department mismatch deterministically forces the score to 0,
// regardless of what the model scored, while 'match'/'not_stated'/absent never gate.

import { normalizeAiScore, isDepartmentMismatch, finalCriterionScore, CriterionResult } from './aiScore';

const r = (over: Partial<CriterionResult>): CriterionResult =>
    ({ criterion_id: 'c1', confidence: 0.9, rationale: 'x', ...over });

describe('normalizeAiScore', () => {
    it('binary: uses met when present', () => {
        expect(normalizeAiScore('binary', r({ met: true }))).toBe(1);
        expect(normalizeAiScore('binary', r({ met: false }))).toBe(0);
    });

    it('binary: falls back to score >= 0.5 when met is missing', () => {
        expect(normalizeAiScore('binary', r({ score: 0.7 }))).toBe(1);
        expect(normalizeAiScore('binary', r({ score: 0.3 }))).toBe(0);
    });

    it('checklist: snaps to the nearest of 0 / 0.5 / 1', () => {
        expect(normalizeAiScore('checklist', r({ score: 0.6 }))).toBe(0.5);
        expect(normalizeAiScore('checklist', r({ score: 0.9 }))).toBe(1);
        expect(normalizeAiScore('checklist', r({ score: 0.2 }))).toBe(0);
    });

    it('percentage: clamps to 0..1 and keeps the value', () => {
        expect(normalizeAiScore('percentage', r({ score: 0.42 }))).toBe(0.42);
        expect(normalizeAiScore('percentage', r({ score: 1.5 }))).toBe(1);
        expect(normalizeAiScore('percentage', r({ score: -0.2 }))).toBe(0);
    });

    it('returns 0 when the model returned nothing for the criterion', () => {
        expect(normalizeAiScore('percentage', undefined)).toBe(0);
    });
});

describe('isDepartmentMismatch', () => {
    it('is true only for an explicit "mismatch"', () => {
        expect(isDepartmentMismatch(r({ department_match: 'mismatch' }))).toBe(true);
        expect(isDepartmentMismatch(r({ department_match: 'match' }))).toBe(false);
        expect(isDepartmentMismatch(r({ department_match: 'not_stated' }))).toBe(false);
        expect(isDepartmentMismatch(r({}))).toBe(false);           // field absent
        expect(isDepartmentMismatch(undefined)).toBe(false);
    });
});

describe('finalCriterionScore — provenance gate', () => {
    it('forces 0 on mismatch even when the model scored full marks', () => {
        expect(finalCriterionScore('binary', r({ met: true, department_match: 'mismatch' }))).toBe(0);
        expect(finalCriterionScore('percentage', r({ score: 1, department_match: 'mismatch' }))).toBe(0);
        expect(finalCriterionScore('checklist', r({ score: 1, department_match: 'mismatch' }))).toBe(0);
    });

    it('does not gate when the department matches', () => {
        expect(finalCriterionScore('binary', r({ met: true, department_match: 'match' }))).toBe(1);
        expect(finalCriterionScore('percentage', r({ score: 0.8, department_match: 'match' }))).toBe(0.8);
    });

    it('does not gate when the document does not state a department', () => {
        expect(finalCriterionScore('binary', r({ met: true, department_match: 'not_stated' }))).toBe(1);
    });

    it('does not gate when the field is absent (back-compat with an older model reply)', () => {
        expect(finalCriterionScore('percentage', r({ score: 0.75 }))).toBe(0.75);
    });
});
