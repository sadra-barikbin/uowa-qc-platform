/* eslint-disable @typescript-eslint/no-var-requires */
// Unit tests for the in-memory AI-evaluation job registry (utils/aiJobs.ts).
//
// The models layer and the LLM grader are mocked, so these tests touch neither Postgres
// nor the Anthropic API — they exercise only the orchestration: which indicators get graded,
// progress/lifecycle bookkeeping, the one-run-per-department guard, and that a single
// indicator failing doesn't abort the batch.
//
// jest.resetModules() before each test gives every test a fresh copy of aiJobs' module-level
// maps (jobs / runningByScope / latestByScope), so state can't leak between tests.

jest.mock('../models', () => ({
    EvaluationPeriod: { findByPk: jest.fn() },
    PeriodIndicator: {},
    Indicator: {},
}));
jest.mock('./aiEvaluator', () => ({
    aiEvaluateIndicator: jest.fn(),
}));

// A period whose active indicators are the given [id, name] pairs, shaped like the
// EvaluationPeriod.findByPk(...) result aiJobs reads (period_indicators[].indicator).
const periodWith = (indicators: Array<[string, string]>) => ({
    period_indicators: indicators.map(([id, name_ar]) => ({ indicator: { id, name_ar } })),
});

// A minimal successful grader result for one indicator (one graded criterion).
const okResult = (indicatorId: string) => ({
    model: 'test-model',
    evaluated: [{ criterion_id: `${indicatorId}-c1`, name_ar: 'معيار', score: 1, confidence: 0.9, rationale: 'ok' }],
    skipped: [],
});

// Poll the job until it leaves 'running' (the loop is fire-and-forget). The mocked grader
// resolves on the microtask queue, so this settles almost immediately.
async function waitForDone(getAiJob: (id: string) => any, id: string) {
    for (let i = 0; i < 200; i++) {
        const job = getAiJob(id);
        if (job && job.status !== 'running') return job;
        await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error('job did not finish in time');
}

// Deferred promise handle, for holding a grade "in flight" to test the running-state guard.
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

let aiJobs: typeof import('./aiJobs');
let EvaluationPeriod: { findByPk: jest.Mock };
let aiEvaluateIndicator: jest.Mock;

beforeEach(() => {
    jest.resetModules();
    aiJobs = require('./aiJobs');
    ({ EvaluationPeriod } = require('../models'));
    ({ aiEvaluateIndicator } = require('./aiEvaluator'));
});

describe('startAiJob', () => {
    test('grades every active indicator when no subset is given', async () => {
        EvaluationPeriod.findByPk.mockResolvedValue(periodWith([['i1', 'مؤشر ١'], ['i2', 'مؤشر ٢'], ['i3', 'مؤشر ٣']]));
        // Gate every grade on one deferred so the loop parks at the first await — this makes the
        // initial snapshot deterministic (indicator 1 running, the rest still queued).
        const gate = deferred<void>();
        aiEvaluateIndicator.mockImplementation((_p: string, _d: string, indId: string) => gate.promise.then(() => okResult(indId)));

        const job = await aiJobs.startAiJob({ period_id: 'p1', department_id: 'd1', evaluatedBy: 'u1' });
        // The call returns immediately, with grading parked on the first indicator.
        expect(job.status).toBe('running');
        expect(job.total).toBe(3);
        expect(job.indicators.map((i) => i.status)).toEqual(['running', 'pending', 'pending']);
        expect(aiJobs.anyAiJobRunning()).toBe(true);

        gate.resolve(); // let all three grades proceed
        const done = await waitForDone(aiJobs.getAiJob, job.id);
        expect(done.status).toBe('done');
        expect(done.completed).toBe(3);
        expect(done.indicators.map((i: any) => i.status)).toEqual(['done', 'done', 'done']);
        expect(done.evaluated).toHaveLength(3);
        expect(aiEvaluateIndicator).toHaveBeenCalledTimes(3);
        // Each indicator graded for the right (period, department, indicator, evaluator).
        expect(aiEvaluateIndicator).toHaveBeenCalledWith('p1', 'd1', 'i1', 'u1');
        expect(aiEvaluateIndicator).toHaveBeenCalledWith('p1', 'd1', 'i3', 'u1');
        // Registry clears the running flag once finished.
        expect(aiJobs.anyAiJobRunning()).toBe(false);
    });

    test('grades only the requested subset', async () => {
        EvaluationPeriod.findByPk.mockResolvedValue(periodWith([['i1', 'a'], ['i2', 'b'], ['i3', 'c']]));
        aiEvaluateIndicator.mockImplementation((_p: string, _d: string, indId: string) => Promise.resolve(okResult(indId)));

        const job = await aiJobs.startAiJob({ period_id: 'p1', department_id: 'd1', indicator_ids: ['i2'], evaluatedBy: 'u1' });
        expect(job.total).toBe(1);
        const done = await waitForDone(aiJobs.getAiJob, job.id);

        expect(done.completed).toBe(1);
        expect(aiEvaluateIndicator).toHaveBeenCalledTimes(1);
        expect(aiEvaluateIndicator).toHaveBeenCalledWith('p1', 'd1', 'i2', 'u1');
    });

    test('rejects (400) when the subset matches no active indicator', async () => {
        EvaluationPeriod.findByPk.mockResolvedValue(periodWith([['i1', 'a']]));
        await expect(
            aiJobs.startAiJob({ period_id: 'p1', department_id: 'd1', indicator_ids: ['does-not-exist'], evaluatedBy: 'u1' }),
        ).rejects.toMatchObject({ status: 400 });
        expect(aiEvaluateIndicator).not.toHaveBeenCalled();
    });

    test('rejects (404) when the period is missing', async () => {
        EvaluationPeriod.findByPk.mockResolvedValue(null);
        await expect(
            aiJobs.startAiJob({ period_id: 'nope', department_id: 'd1', evaluatedBy: 'u1' }),
        ).rejects.toMatchObject({ status: 404 });
    });

    test('rejects (409) a second run for the same department while one is in flight', async () => {
        EvaluationPeriod.findByPk.mockResolvedValue(periodWith([['i1', 'a']]));
        const gate = deferred<any>();
        aiEvaluateIndicator.mockReturnValue(gate.promise); // first grade hangs → job stays running

        const first = await aiJobs.startAiJob({ period_id: 'p1', department_id: 'd1', evaluatedBy: 'u1' });
        expect(aiJobs.anyAiJobRunning()).toBe(true);

        await expect(
            aiJobs.startAiJob({ period_id: 'p1', department_id: 'd1', evaluatedBy: 'u1' }),
        ).rejects.toMatchObject({ status: 409 });

        // A different department is unaffected and can start concurrently.
        EvaluationPeriod.findByPk.mockResolvedValue(periodWith([['i1', 'a']]));
        aiEvaluateIndicator.mockImplementation((_p: string, _d: string, indId: string) => Promise.resolve(okResult(indId)));
        const other = await aiJobs.startAiJob({ period_id: 'p1', department_id: 'd2', evaluatedBy: 'u1' });
        expect(other.id).not.toBe(first.id);

        // Let the first job finish so nothing is left hanging.
        gate.resolve(okResult('i1'));
        await waitForDone(aiJobs.getAiJob, first.id);
        await waitForDone(aiJobs.getAiJob, other.id);
        expect(aiJobs.anyAiJobRunning()).toBe(false);
    });

    test('one indicator failing does not abort the batch', async () => {
        EvaluationPeriod.findByPk.mockResolvedValue(periodWith([['i1', 'a'], ['i2', 'b'], ['i3', 'c']]));
        aiEvaluateIndicator.mockImplementation((_p: string, _d: string, indId: string) =>
            indId === 'i2' ? Promise.reject(new Error('boom')) : Promise.resolve(okResult(indId)));

        const job = await aiJobs.startAiJob({ period_id: 'p1', department_id: 'd1', evaluatedBy: 'u1' });
        const done = await waitForDone(aiJobs.getAiJob, job.id);

        expect(done.status).toBe('done');       // batch still completes
        expect(done.completed).toBe(3);          // all three attempted
        const byId = Object.fromEntries(done.indicators.map((i: any) => [i.indicator_id, i]));
        expect(byId.i1.status).toBe('done');
        expect(byId.i3.status).toBe('done');
        expect(byId.i2.status).toBe('error');
        expect(byId.i2.error).toBe('boom');
        expect(done.evaluated).toHaveLength(2);  // only the successful indicators contributed
    });
});

describe('getLatestAiJob', () => {
    test('returns the most recent job for a period+department', async () => {
        EvaluationPeriod.findByPk.mockResolvedValue(periodWith([['i1', 'a']]));
        aiEvaluateIndicator.mockImplementation((_p: string, _d: string, indId: string) => Promise.resolve(okResult(indId)));

        const first = await aiJobs.startAiJob({ period_id: 'p1', department_id: 'd1', evaluatedBy: 'u1' });
        await waitForDone(aiJobs.getAiJob, first.id);
        const second = await aiJobs.startAiJob({ period_id: 'p1', department_id: 'd1', evaluatedBy: 'u1' });
        await waitForDone(aiJobs.getAiJob, second.id);

        expect(aiJobs.getLatestAiJob('p1', 'd1')?.id).toBe(second.id);
        expect(aiJobs.getLatestAiJob('p1', 'other')).toBeUndefined();
    });
});
