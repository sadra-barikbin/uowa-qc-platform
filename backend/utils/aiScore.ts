// Pure scoring helpers for the AI assessor — no models and no Anthropic SDK imports, so they
// unit-test without a live Postgres or the API (see aiScore.test.ts). aiEvaluator.ts owns the
// I/O (reading documents, calling Claude, upserting evaluations) and delegates the actual
// score derivation to the functions here.

export interface CriterionResult {
    criterion_id: string;
    score?: number;      // 0..1 — checklist (0/0.5/1) and percentage
    met?: boolean;       // binary
    confidence: number;  // 0..1
    rationale: string;   // Arabic reasoning + citation
    // Provenance the model read off the evidence: does it belong to the exact department being
    // evaluated? 'mismatch' = clearly a different department (even a same-college sibling);
    // 'not_stated' = the documents don't identify a department at all.
    department_match?: 'match' | 'mismatch' | 'not_stated';
}

const snapChecklist = (v: number): number =>
    [0, 0.5, 1].reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), 0);

// Coerce the model's answer into the 0..1 score the criterion's type allows.
export function normalizeAiScore(type: string, r?: CriterionResult): number {
    if (!r) return 0;
    if (type === 'binary') {
        if (typeof r.met === 'boolean') return r.met ? 1 : 0;
        return r.score != null && Number(r.score) >= 0.5 ? 1 : 0; // fallback if the model returned a score
    }
    const s = Math.min(1, Math.max(0, Number(r.score ?? (r.met ? 1 : 0))));
    return type === 'checklist' ? snapChecklist(s) : s;
}

// Deterministic provenance gate. The model reliably *detects* when evidence belongs to another
// department (it says so in its rationale) but has been observed to still score it as fully met,
// rationalizing that the per-criterion guidance didn't explicitly demand a department match. So
// we don't leave the consequence to the model: an explicit 'mismatch' forces the score to 0,
// whatever the model assigned. 'not_stated' does NOT gate — matching the prompt rule that a
// document which simply omits its department must not be penalized on that basis alone.
export function isDepartmentMismatch(r?: CriterionResult): boolean {
    return r?.department_match === 'mismatch';
}

// The score actually stored for a criterion: the type-normalized score, then the provenance gate.
export function finalCriterionScore(type: string, r?: CriterionResult): number {
    return isDepartmentMismatch(r) ? 0 : normalizeAiScore(type, r);
}
