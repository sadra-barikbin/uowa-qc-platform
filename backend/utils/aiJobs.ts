import crypto from 'crypto';
import { EvaluationPeriod, PeriodIndicator, Indicator } from '../models';
import { aiEvaluateIndicator, AiEvaluationResult } from './aiEvaluator';
import { notifyAiEvaluationComplete } from './notifications';

// ─────────────────────────────────────────────────────────────────────────────
// Background AI-evaluation jobs.
//
// "Evaluate all" (and a single-indicator run) used to be orchestrated in the
// browser: the React page fired one POST /api/evaluations/ai per indicator and
// awaited each. That tied the batch's lifetime to the page — navigating away lost
// the progress UI, and there was no way to reconnect to an in-flight run.
//
// Here the orchestration lives in the backend instead: a job runs the per-indicator
// loop server-side and records progress, and the UI just *observes* it (polling
// GET /ai/jobs/:id). Because the desktop backend is a single child process, jobs
// live in memory — they survive page navigation, minimize and focus loss, but not
// a full app close. That's acceptable: every indicator's Evaluation rows are already
// persisted by aiEvaluateIndicator the moment that indicator finishes, so a job
// that dies mid-run leaves completed work saved and only the unfinished indicators
// need re-running. The desktop shell warns before closing while a job is running
// (see /api/health `aiRunning`).
// ─────────────────────────────────────────────────────────────────────────────

export type AiJobStatus = 'running' | 'done' | 'error';

export type AiIndicatorStatus = 'pending' | 'running' | 'done' | 'error';

export interface AiJobIndicator {
    indicator_id: string;
    name_ar: string;
    status: AiIndicatorStatus;
    error?: string;
}

export interface AiJob {
    id: string;
    period_id: string;
    department_id: string;
    status: AiJobStatus;
    total: number;
    completed: number;                       // indicators finished (done or error)
    indicators: AiJobIndicator[];
    evaluated: AiEvaluationResult['evaluated']; // cumulative — the UI patches these in
    skipped: AiEvaluationResult['skipped'];     // cumulative
    error: string | null;                    // fatal, job-level error only
    started_at: string;
    finished_at: string | null;
    evaluated_by: string;
}

class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}

const jobs = new Map<string, AiJob>();              // jobId -> job (finished jobs kept for a while)
const runningByScope = new Map<string, string>();   // "period:dept" -> jobId, only while running
const latestByScope = new Map<string, string>();    // "period:dept" -> most recent jobId (any status)

const scopeKey = (period_id: string, department_id: string) => `${period_id}:${department_id}`;
const FINISHED_TTL_MS = 60 * 60 * 1000; // prune finished jobs an hour after they end

// Drop finished jobs whose result nobody is likely polling for any more, so the maps
// don't grow without bound over a long-running desktop session.
function pruneFinished(): void {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (job.status === 'running') continue;
        if (job.finished_at && now - new Date(job.finished_at).getTime() > FINISHED_TTL_MS) {
            jobs.delete(id);
            if (latestByScope.get(scopeKey(job.period_id, job.department_id)) === id) {
                latestByScope.delete(scopeKey(job.period_id, job.department_id));
            }
        }
    }
}

export function getAiJob(id: string): AiJob | undefined {
    return jobs.get(id);
}

// The most recent job for a period+department (running or recently finished), so the
// page can reconnect after a navigation/minimize and render its state.
export function getLatestAiJob(period_id: string, department_id: string): AiJob | undefined {
    const id = latestByScope.get(scopeKey(period_id, department_id));
    return id ? jobs.get(id) : undefined;
}

// Cheap flag for the desktop shell's close-warning (GET /api/health).
export function anyAiJobRunning(): boolean {
    return runningByScope.size > 0;
}

interface StartJobArgs {
    period_id: string;
    department_id: string;
    indicator_ids?: string[];   // omit/empty → every active indicator for the period
    evaluatedBy: string;
}

// Create and kick off a job. Returns the initial snapshot immediately; the loop runs
// in the background. Rejects if a job is already running for this period+department.
export async function startAiJob({ period_id, department_id, indicator_ids, evaluatedBy }: StartJobArgs): Promise<AiJob> {
    pruneFinished();

    const scope = scopeKey(period_id, department_id);
    if (runningByScope.has(scope)) {
        throw new HttpError(409, 'يوجد تقييم آلي قيد التنفيذ لهذا القسم بالفعل');
    }

    // Resolve which indicators to grade, in the period's display order. When the caller
    // passes indicator_ids we keep only those that are actually active for this period,
    // so a stale id from the UI can't spin an empty or invalid job.
    const period = await EvaluationPeriod.findByPk(period_id, {
        include: [{
            model: PeriodIndicator, as: 'period_indicators', where: { is_active: true }, required: false,
            include: [{ model: Indicator, as: 'indicator' }],
        }],
    });
    if (!period) throw new HttpError(404, 'Period not found');

    const active = (period.period_indicators || [])
        .map(pi => pi.indicator)
        .filter((i): i is Indicator => !!i);
    const wanted = indicator_ids && indicator_ids.length ? new Set(indicator_ids) : null;
    const chosen = wanted ? active.filter(i => wanted.has(i.id)) : active;
    if (chosen.length === 0) throw new HttpError(400, 'لا توجد مؤشرات فعّالة للتقييم');

    const job: AiJob = {
        id: crypto.randomUUID(),
        period_id,
        department_id,
        status: 'running',
        total: chosen.length,
        completed: 0,
        indicators: chosen.map(i => ({ indicator_id: i.id, name_ar: i.name_ar, status: 'pending' })),
        evaluated: [],
        skipped: [],
        error: null,
        started_at: new Date().toISOString(),
        finished_at: null,
        evaluated_by: evaluatedBy,
    };
    jobs.set(job.id, job);
    runningByScope.set(scope, job.id);
    latestByScope.set(scope, job.id);

    // Fire and forget — runJob owns the job's lifecycle and never rejects.
    void runJob(job);
    return job;
}

// The server-side batch loop. Grades indicators one at a time (sequential, matching the
// previous client behaviour — it keeps API pressure predictable and rationales ordered),
// recording progress on the job as it goes. One indicator failing never aborts the batch.
async function runJob(job: AiJob): Promise<void> {
    for (const item of job.indicators) {
        item.status = 'running';
        try {
            const result = await aiEvaluateIndicator(job.period_id, job.department_id, item.indicator_id, job.evaluated_by);
            job.evaluated.push(...result.evaluated);
            job.skipped.push(...result.skipped);
            item.status = 'done';
        } catch (err) {
            item.status = 'error';
            item.error = (err as Error).message;
        } finally {
            job.completed += 1;
        }
    }
    job.status = 'done';
    job.finished_at = new Date().toISOString();
    runningByScope.delete(scopeKey(job.period_id, job.department_id));

    // Leave a durable notification for whoever started the run — they may have navigated away,
    // so the in-page completion toast alone isn't enough. Best-effort; never fails the job.
    await notifyAiEvaluationComplete({
        user_id: job.evaluated_by,
        period_id: job.period_id,
        department_id: job.department_id,
        evaluated: job.evaluated.length,
        skipped: job.skipped.length,
        failed: job.indicators.filter(i => i.status === 'error').length,
    });
}
