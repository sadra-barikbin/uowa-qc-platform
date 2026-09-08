import { useSyncExternalStore } from 'react';
import toast from 'react-hot-toast';
import { evaluationsAPI } from './api';

// ─── Where an AI evaluation run lives ────────────────────────────────────────
// One AI call per indicator, each of which reads that indicator's uploaded documents — so a
// whole-department run ("تقييم آلي للكل") routinely takes minutes. That loop used to live inside
// the Evaluations component, which meant the run vanished from the UI the moment the user
// navigated to another page: the loop itself kept going and every finished indicator was still
// saved server-side, but the progress counter, the per-indicator spinner and the "a run is already
// in flight" guard were all component state, so coming back showed an idle page with a fully
// enabled run button (and a second run could be started on top of the first).
//
// Keeping the run in this module-level store fixes that: navigation doesn't touch it, any page can
// read the live progress, and returning to Evaluations renders the run as it actually is.
//
// What this still does NOT survive is a page reload or quitting the app — the loop is browser-side
// and each indicator's HTTP request dies with the page. Both paths now warn first (`beforeunload`
// below, plus the desktop shell's close/quit dialog driven by the busy flag pushed to it). Moving
// the run into a server-side job is the real fix; this is the UX floor under it.

const IDLE = {
    running: false,
    scope: null,              // 'all' (whole department) | 'one' (single indicator)
    periodId: null,
    departmentId: null,
    departmentName: '',
    indicatorIds: [],
    total: 0,
    done: 0,                  // indicators finished, successfully or not
    failed: 0,
    currentIndicatorId: null,
    results: {},              // criterion_id -> evaluation, accumulated across this run
    delta: null,              // just the indicator that finished last
    seq: 0,                   // bumped with each delta, so a page applies every one exactly once
};

let state = IDLE;
const listeners = new Set();

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// Identity only changes inside set(), which is what useSyncExternalStore requires of a snapshot.
const getSnapshot = () => state;

function set(patch) {
    state = { ...state, ...patch };
    listeners.forEach(fn => fn());
}

/** Live run state; re-renders the caller on every change. */
export function useAiRun() {
    return useSyncExternalStore(subscribe, getSnapshot);
}

/** Current run state for non-React callers (no subscription). */
export function getAiRun() {
    return state;
}

// Shape one /ai result row into the evaluation object the matrix renders.
export const aiEvalToEvaluation = (e) => ({
    score: e.score,
    evaluation_method: 'ai',
    ai_confidence: e.confidence,
    ai_rationale: e.rationale,
    reviewer_notes: e.rationale,
    raw_values: {},
});

const UNLOAD_WARNING = 'التقييم الآلي قيد التنفيذ.';
const warnOnUnload = (e) => { e.preventDefault(); e.returnValue = UNLOAD_WARNING; return UNLOAD_WARNING; };

// In the desktop build, closing the window also kills the backend child process, so the shell has
// to ask before it does. `window.qcDesktop` is the desktop preload bridge (see
// desktop/preload-app.js); in a plain browser it is absent and `beforeunload` warns on its own.
function setBusy(busy) {
    try {
        if (window.qcDesktop && window.qcDesktop.setAiBusy) window.qcDesktop.setAiBusy(busy);
    } catch { /* not the desktop build, or the bridge is gone — beforeunload still applies */ }
    if (busy) window.addEventListener('beforeunload', warnOnUnload);
    else window.removeEventListener('beforeunload', warnOnUnload);
}

const progressLabel = (done, total) => (total > 1 ? `التقييم الآلي: ${done}/${total}` : 'جاري التقييم الآلي...');

/**
 * Run the AI assessor over one or more indicators of one department, one indicator at a time.
 * Only one run at a time: the calls are heavy and their results all land in the same matrix.
 * Resolves when the run finishes; progress is published through the store as it goes.
 */
export async function startAiRun({ periodId, departmentId, departmentName = '', indicatorIds }) {
    if (state.running) { toast.error('هناك تقييم آلي قيد التنفيذ بالفعل'); return; }
    const ids = (indicatorIds || []).filter(Boolean);
    if (!periodId || !departmentId || !ids.length) return;

    set({
        ...IDLE,
        seq: state.seq, // keep counting up across runs — a page tracks the last seq it applied
        running: true,
        scope: ids.length > 1 ? 'all' : 'one',
        periodId, departmentId, departmentName,
        indicatorIds: ids,
        total: ids.length,
    });
    setBusy(true);

    const t = toast.loading(progressLabel(0, ids.length));
    let evaluated = 0, skipped = 0, lastError = null;
    try {
        for (const id of ids) {
            set({ currentIndicatorId: id });
            try {
                const r = await evaluationsAPI.ai({ period_id: periodId, department_id: departmentId, indicator_id: id });
                const rows = r.data?.evaluated || [];
                const delta = {};
                rows.forEach(e => { delta[e.criterion_id] = aiEvalToEvaluation(e); });
                evaluated += rows.length;
                skipped += (r.data?.skipped || []).length;
                set({ done: state.done + 1, delta, seq: state.seq + 1, results: { ...state.results, ...delta } });
            } catch (err) {
                // Keep going — one indicator failing shouldn't abort the rest of the batch.
                lastError = err.response?.data?.error || 'خطأ في التقييم الآلي';
                set({ done: state.done + 1, failed: state.failed + 1 });
            }
            toast.loading(progressLabel(state.done, ids.length), { id: t });
        }

        if (state.failed === ids.length) {
            toast.error(lastError || 'تعذّر التقييم الآلي', { id: t });
        } else {
            const parts = [`${evaluated} معياراً`];
            if (skipped) parts.push(`تُخطّي ${skipped} بلا مستندات`);
            if (state.failed) parts.push(`تعذّر ${state.failed} مؤشراً`);
            toast.success(`اكتمل التقييم الآلي — ${parts.join(' · ')}`, { id: t });
        }
    } finally {
        set({ running: false, currentIndicatorId: null });
        setBusy(false);
    }
}
