import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { departmentsAPI, periodsAPI, submissionsAPI, evaluationsAPI } from '../../utils/api';
import usePersistentState from '../../hooks/usePersistentState';

const scoreColor = s => s >= 90 ? '#0e9f6e' : s >= 70 ? '#1a56db' : s >= 50 ? '#c27803' : '#e02424';
const LOW_CONF = 0.8; // AI scores under this confidence are flagged for a closer look

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Classify one criterion's evaluation into a review status.
function critStatus(evaluation) {
    if (!evaluation || evaluation.score == null) return 'unscored';
    if (evaluation.evaluation_method === 'ai') {
        const c = evaluation.ai_confidence;
        if (c != null && Number(c) < LOW_CONF) return 'low';
        return 'ai';
    }
    return 'done';
}

const STATUS = {
    unscored: { dot: '#9ca3af', label: 'غير مُقيَّم' },
    ai: { dot: '#1a56db', label: 'بانتظار المراجعة' },
    low: { dot: '#c27803', label: 'ثقة منخفضة' },
    done: { dot: '#0e9f6e', label: 'مكتمل' },
};

// Period-status labels (mirror of the backend). Scoring is only permitted while the period
// is `under_review`; every other state is read-only here — the backend enforces the same rule.
const PERIOD_STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة للرفع', under_review: 'قيد المراجعة', published: 'منشورة', closed: 'مغلقة' };
const EVAL_STATE = 'under_review';

// Per-indicator rollup: counts + weighted % (unscored counts as 0 once anything is scored).
function indicatorStats(group) {
    let scored = 0, aiPending = 0, low = 0, wsum = 0, wnum = 0, any = false;
    group.criteria.forEach(({ criterion, evaluation }) => {
        const st = critStatus(evaluation);
        const w = Number(criterion.weight) || 0;
        wsum += w;
        if (st !== 'unscored') { scored++; any = true; wnum += Number(evaluation.score) * w; }
        if (st === 'ai') aiPending++;
        if (st === 'low') low++;
    });
    const pct = any && wsum > 0 ? Math.round((wnum / wsum) * 100) : null;
    // worst-first, so the index dot signals what needs attention
    const worst = low ? 'low' : (scored < group.criteria.length ? 'unscored' : (aiPending ? 'ai' : 'done'));
    return { total: group.criteria.length, scored, aiPending, low, pct, worst };
}

export default function Evaluations() {
    const [searchParams] = useSearchParams();
    const [periods, setPeriods] = useState([]);
    const [departments, setDepartments] = useState([]);
    // Sticky across navigation: returning to this page keeps the last period/department
    // (a deep link's ?period=&department= still wins). See usePersistentState.
    const [selPeriod, setSelPeriod] = usePersistentState('eval:period', searchParams.get('period'));
    const [selDept, setSelDept] = usePersistentState('eval:department', searchParams.get('department'));
    const [matrix, setMatrix] = useState([]);
    const [rowState, setRowState] = useState({}); // criterion_id -> { percent, numerator, denominator, notes }
    const [savingId, setSavingId] = useState(null);
    const [acceptingAll, setAcceptingAll] = useState(false);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState({}); // indicator_id -> bool
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState('all'); // all | unscored | ai | low
    const cardRefs = useRef({});

    // Background AI-evaluation job the backend runs (survives navigation/minimize; the page
    // only observes it). `job` is the latest snapshot; the refs track what we've already
    // reflected so a poll patches only newly-graded criteria and finalizes exactly once.
    const [job, setJob] = useState(null);
    const patchedRef = useRef({ jobId: null, count: 0 });
    const finalizedRef = useRef(new Set());
    const applyRef = useRef(() => {});

    useEffect(() => {
        periodsAPI.list().then(r => {
            const ps = r.data.periods || [];
            setPeriods(ps);
            // Keep a valid remembered/deep-linked period; otherwise fall back to the latest.
            setSelPeriod(cur => (cur && ps.some(p => p.id === cur)) ? cur : (ps[0]?.id || ''));
        }).catch(() => {});
        departmentsAPI.list().then(r => {
            const ds = r.data.departments || [];
            setDepartments(ds);
            // Drop a remembered department that no longer exists so the picker isn't stuck on it.
            setSelDept(cur => (cur && ds.some(d => d.id === cur)) ? cur : '');
        }).catch(() => {});
    }, []);

    const loadMatrix = useCallback(() => {
        if (!selPeriod || !selDept) { setMatrix([]); return; }
        setLoading(true);
        evaluationsAPI.matrix({ period_id: selPeriod, department_id: selDept })
            .then(r => {
                const m = r.data.matrix || [];
                setMatrix(m);
                const rs = {};
                m.forEach(group => group.criteria.forEach(({ criterion, evaluation }) => {
                    rs[criterion.id] = {
                        percent: evaluation?.score != null ? Math.round(Number(evaluation.score) * 100) : '',
                        numerator: evaluation?.raw_values?.numerator ?? '',
                        denominator: evaluation?.raw_values?.denominator ?? '',
                        notes: evaluation?.reviewer_notes || '',
                    };
                }));
                setRowState(rs);
                setExpanded({}); // all indicators collapsed by default; the index + filters drive navigation
            })
            .catch(err => { toast.error(err.response?.data?.error || 'تعذر تحميل البيانات'); setMatrix([]); })
            .finally(() => setLoading(false));
    }, [selPeriod, selDept]);

    useEffect(() => { loadMatrix(); }, [loadMatrix]);

    // Scoring is gated by the period's state — enabled only while it is `under_review`.
    const selectedPeriod = periods.find(p => p.id === selPeriod) || null;
    const canEvaluate = selectedPeriod?.status === EVAL_STATE;

    // Reconnect to a running job when the period/department changes (or on first load), so
    // returning to this page mid-run shows live progress instead of a dead button. Finished
    // jobs are already reflected by loadMatrix, so we only observe running ones.
    const reconnect = useCallback(async () => {
        if (!selPeriod || !selDept) { setJob(null); return; }
        try {
            const r = await evaluationsAPI.activeAiJob({ period_id: selPeriod, department_id: selDept });
            const j = r.data.job;
            if (j && j.status === 'running') {
                // The just-loaded matrix already holds the indicators finished so far; start
                // patching from here so we don't restamp (and wipe edits on) loaded rows.
                patchedRef.current = { jobId: j.id, count: j.evaluated.length };
                finalizedRef.current.delete(j.id);
                setJob(j);
            } else {
                setJob(null);
            }
        } catch { setJob(null); }
    }, [selPeriod, selDept]);
    useEffect(() => { reconnect(); }, [reconnect]);

    // Poll the active job while it runs; applyRef.current holds the latest applier so this
    // effect needn't re-subscribe on every render. Cleared as soon as the job leaves 'running'.
    useEffect(() => {
        if (!job || job.status !== 'running') return undefined;
        let cancelled = false;
        const tick = async () => {
            try { const r = await evaluationsAPI.getAiJob(job.id); if (!cancelled) applyRef.current(r.data.job); }
            catch (err) { if (err.response?.status === 404 && !cancelled) setJob(null); } // pruned/gone
        };
        const iv = setInterval(tick, 1500);
        return () => { cancelled = true; clearInterval(iv); };
    }, [job?.id, job?.status]);

    const updateRow = (criterionId, patch) => setRowState(prev => ({ ...prev, [criterionId]: { ...prev[criterionId], ...patch } }));

    // Whether the score input has the value(s) needed to save (0 is valid; '' / null is not).
    const rowComplete = (criterion) => {
        const st = rowState[criterion.id] || {};
        const filled = v => v !== '' && v != null;
        return criterion.criterion_type === 'ratio' ? filled(st.numerator) && filled(st.denominator) : filled(st.percent);
    };

    // Whether the row's inputs differ from the stored evaluation (nothing to save otherwise).
    const rowDirty = (criterion, evaluation) => {
        const st = rowState[criterion.id] || {};
        if (String(st.notes || '') !== String(evaluation?.reviewer_notes || '')) return true;
        if (criterion.criterion_type === 'ratio') {
            return String(st.numerator ?? '') !== String(evaluation?.raw_values?.numerator ?? '')
                || String(st.denominator ?? '') !== String(evaluation?.raw_values?.denominator ?? '');
        }
        const storedPercent = evaluation?.score != null ? Math.round(Number(evaluation.score) * 100) : '';
        return String(st.percent ?? '') !== String(storedPercent);
    };

    // Update evaluations in local state in place — no full reload, so the page doesn't flash,
    // accordions stay as they are, and unsaved edits in other rows survive.
    const patchEvaluations = (updates) => {
        setMatrix(prev => prev.map(g => ({
            ...g,
            criteria: g.criteria.map(item => (updates[item.criterion.id] ? { ...item, evaluation: updates[item.criterion.id] } : item)),
        })));
        setRowState(prev => {
            const next = { ...prev };
            Object.entries(updates).forEach(([cid, ev]) => {
                next[cid] = {
                    percent: ev?.score != null ? Math.round(Number(ev.score) * 100) : '',
                    numerator: ev?.raw_values?.numerator ?? '',
                    denominator: ev?.raw_values?.denominator ?? '',
                    notes: ev?.reviewer_notes || '',
                };
            });
            return next;
        });
    };
    // Shape an /ai result row into an evaluation object for patchEvaluations.
    const aiEvalToEvaluation = e => ({ score: e.score, evaluation_method: 'ai', ai_confidence: e.confidence, ai_rationale: e.rationale, reviewer_notes: e.rationale, raw_values: {} });

    const saveRow = async (criterion, submissionId) => {
        if (!canEvaluate) return;
        const state = rowState[criterion.id] || {};
        const payload = { period_id: selPeriod, department_id: selDept, criterion_id: criterion.id, submission_id: submissionId, reviewer_notes: state.notes };
        if (criterion.criterion_type === 'ratio') {
            if (state.numerator === '' || state.denominator === '') { toast.error('أدخل البسط والمقام'); return; }
            payload.raw_values = { numerator: Number(state.numerator), denominator: Number(state.denominator) };
        } else {
            if (state.percent === '') { toast.error('أدخل التقييم'); return; }
            payload.score = Number(state.percent) / 100; // binary / checklist / percentage → 0-1 fraction
        }
        setSavingId(criterion.id);
        try {
            const res = await evaluationsAPI.save(payload);
            patchEvaluations({ [criterion.id]: res.data.evaluation });
            toast.success('تم حفظ التقييم');
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ في الحفظ'); }
        finally { setSavingId(null); }
    };

    // Build the save payload that re-records an AI suggestion's exact score as a manual
    // (assessor-approved) evaluation. The backend keeps ai_confidence/ai_rationale, so the
    // reasoning trail survives the conversion.
    const aiAcceptPayload = (criterion, evaluation, submissionId) => {
        const p = { period_id: selPeriod, department_id: selDept, criterion_id: criterion.id, submission_id: submissionId, reviewer_notes: evaluation.reviewer_notes || undefined };
        if (criterion.criterion_type === 'ratio') p.raw_values = evaluation.raw_values || {};
        else p.score = Number(evaluation.score); // binary / checklist / percentage are 0-1
        return p; // no evaluation_method → stored as 'manual'
    };

    // Accept one AI suggestion as-is.
    const acceptAi = async (criterion, evaluation, submissionId) => {
        if (!canEvaluate) return;
        setSavingId(criterion.id);
        try {
            const res = await evaluationsAPI.save(aiAcceptPayload(criterion, evaluation, submissionId));
            patchEvaluations({ [criterion.id]: res.data.evaluation });
            toast.success('تم اعتماد تقييم الذكاء الاصطناعي');
        } catch (err) { toast.error(err.response?.data?.error || 'تعذر الاعتماد'); }
        finally { setSavingId(null); }
    };

    // Accept every AI/low-confidence suggestion across the department at once.
    const acceptAllAi = async () => {
        if (!canEvaluate || acceptingAll) return;
        const targets = [];
        matrix.forEach(g => g.criteria.forEach(({ criterion, submission, evaluation }) => {
            const st = critStatus(evaluation);
            if (st === 'ai' || st === 'low') targets.push({ criterion, evaluation, submissionId: submission?.id });
        }));
        if (!targets.length) { toast('لا توجد تقييمات آلية بانتظار الاعتماد'); return; }
        const lowN = targets.filter(t => critStatus(t.evaluation) === 'low').length;
        if (!window.confirm(`اعتماد ${targets.length} تقييماً آلياً كما هي${lowN ? ` (منها ${lowN} بثقة منخفضة)` : ''}؟`)) return;
        setAcceptingAll(true);
        const t = toast.loading(`اعتماد: 0/${targets.length}`);
        let done = 0; const updates = {};
        try {
            for (const tg of targets) {
                try { const res = await evaluationsAPI.save(aiAcceptPayload(tg.criterion, tg.evaluation, tg.submissionId)); if (res?.data?.evaluation) updates[tg.criterion.id] = res.data.evaluation; }
                catch { /* keep going; one failure shouldn't abort the batch */ }
                done++;
                toast.loading(`اعتماد: ${done}/${targets.length}`, { id: t });
            }
            patchEvaluations(updates);
            toast.success(`تم اعتماد ${Object.keys(updates).length} تقييماً`, { id: t });
        } finally { setAcceptingAll(false); }
    };

    // Apply a job snapshot: patch newly-graded criteria into the matrix (only the slice we
    // haven't applied yet, so unsaved edits on other rows survive), store the snapshot, and
    // toast a summary exactly once when it finishes. Kept on a ref so the polling effect and
    // the start/reconnect paths all use the same, always-current closure.
    applyRef.current = (snap) => {
        if (!snap) return;
        if (patchedRef.current.jobId !== snap.id) patchedRef.current = { jobId: snap.id, count: 0 };
        const already = patchedRef.current.count;
        if (snap.evaluated.length > already) {
            const updates = {};
            snap.evaluated.slice(already).forEach(e => { updates[e.criterion_id] = aiEvalToEvaluation(e); });
            patchEvaluations(updates);
            patchedRef.current.count = snap.evaluated.length;
        }
        setJob(snap);
        if (snap.status !== 'running' && !finalizedRef.current.has(snap.id)) {
            finalizedRef.current.add(snap.id);
            const errs = snap.indicators.filter(i => i.status === 'error').length;
            toast.success(`اكتمل التقييم الآلي — ${snap.evaluated.length} معياراً`
                + `${snap.skipped.length ? ` (تُخطّي ${snap.skipped.length})` : ''}`
                + `${errs ? ` · فشل ${errs} مؤشر` : ''}`);
        }
    };

    // Start a background job (a single indicator, or all when indicatorIds is undefined). The
    // backend runs the loop; the polling effect above drives progress from here.
    const startJob = async (indicatorIds) => {
        if (!canEvaluate) return; // scoring gated to `under_review` (backend enforces the same)
        if (job?.status === 'running') { toast('التقييم الآلي قيد التنفيذ بالفعل'); return; }
        try {
            const r = await evaluationsAPI.startAiJob({ period_id: selPeriod, department_id: selDept, indicator_ids: indicatorIds });
            finalizedRef.current.delete(r.data.job.id);
            patchedRef.current = { jobId: r.data.job.id, count: 0 };
            applyRef.current(r.data.job);
        } catch (err) {
            if (err.response?.status === 409) { toast('التقييم الآلي قيد التنفيذ بالفعل'); reconnect(); }
            else toast.error(err.response?.data?.error || 'خطأ في التقييم الآلي');
        }
    };
    const runAi = (indicatorId) => startJob([indicatorId]);
    const runAllAi = () => { if (matrix.length) startJob(undefined); };

    const jobRunning = job?.status === 'running';
    // Indicators still queued/grading in the running job — used to show per-card progress.
    const busyIndicatorIds = useMemo(
        () => (jobRunning ? new Set(job.indicators.filter(i => i.status === 'pending' || i.status === 'running').map(i => i.indicator_id)) : new Set()),
        [job, jobRunning],
    );

    const download = async (doc) => {
        try {
            const res = await submissionsAPI.downloadDocument(doc.id);
            const url = URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a'); a.href = url; a.download = doc.file_name; a.click();
            URL.revokeObjectURL(url);
        } catch { toast.error('تعذر تنزيل الملف'); }
    };

    const jumpTo = (indicatorId) => {
        setExpanded(prev => ({ ...prev, [indicatorId]: true }));
        requestAnimationFrame(() => cardRefs.current[indicatorId]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    const renderScoreInput = (criterion) => {
        const state = rowState[criterion.id] || {};
        if (criterion.criterion_type === 'ratio') {
            const num = Number(state.numerator), den = Number(state.denominator);
            const preview = den > 0 ? Math.min(100, Math.round((num / den) * 100)) : null;
            return (
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <div>
                        <label className="form-hint">{criterion.config?.numerator_label_ar || 'البسط'}</label>
                        <input type="number" className="form-input" style={{ width: 100 }} value={state.numerator} onChange={e => updateRow(criterion.id, { numerator: e.target.value })} disabled={!canEvaluate} />
                    </div>
                    <div>
                        <label className="form-hint">{criterion.config?.denominator_label_ar || 'المقام'}</label>
                        <input type="number" className="form-input" style={{ width: 100 }} value={state.denominator} onChange={e => updateRow(criterion.id, { denominator: e.target.value })} disabled={!canEvaluate} />
                    </div>
                    {preview != null && <span style={{ fontSize: 13, fontWeight: 600, color: scoreColor(preview) }}>= {preview}%</span>}
                </div>
            );
        }
        if (criterion.criterion_type === 'binary') {
            return (
                <select className="form-select" style={{ width: 'auto' }} value={state.percent} onChange={e => updateRow(criterion.id, { percent: e.target.value })} disabled={!canEvaluate}>
                    <option value="">لم يُقيَّم</option>
                    <option value="100">نعم — مستوفٍ</option>
                    <option value="0">لا — غير مستوفٍ</option>
                </select>
            );
        }
        if (criterion.criterion_type === 'checklist') {
            return (
                <select className="form-select" style={{ width: 'auto' }} value={state.percent} onChange={e => updateRow(criterion.id, { percent: e.target.value })} disabled={!canEvaluate}>
                    <option value="">لم يُقيَّم</option>
                    <option value="0">لم يتم (0%)</option>
                    <option value="50">مكتمل جزئياً (50%)</option>
                    <option value="100">مكتمل (100%)</option>
                </select>
            );
        }
        return (
            <div style={{ position: 'relative', width: 120 }}>
                <input
                    type="number" min="0" max="100" className="form-input" style={{ paddingLeft: 28, textAlign: 'center' }}
                    value={state.percent} onChange={e => updateRow(criterion.id, { percent: e.target.value })}
                    placeholder="0-100%" disabled={!canEvaluate}
                />
                <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', fontSize: 13 }}>%</span>
            </div>
        );
    };

    // Filtering: a criterion is visible if it matches the status chip and the search text.
    const query = q.trim().toLowerCase();
    const critVisible = (group, item) => {
        const st = critStatus(item.evaluation);
        if (filter === 'unscored' && st !== 'unscored') return false;
        if (filter === 'ai' && st !== 'ai' && st !== 'low') return false;
        if (filter === 'low' && st !== 'low') return false;
        if (query) {
            const hay = `${item.criterion.name_ar} ${group.indicator.name_ar}`.toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    };
    const filterActive = filter !== 'all' || query !== '';

    const overall = useMemo(() => {
        // Mirrors the backend department_period_scores view: null until anything is scored,
        // then a weighted average where every active indicator counts — unscored ones as 0.
        let total = 0, scored = 0, aiPending = 0, low = 0, iwsumAll = 0, iwnum = 0, anyInd = false;
        matrix.forEach(g => {
            const s = indicatorStats(g);
            total += s.total; scored += s.scored; aiPending += s.aiPending; low += s.low;
            const iw = Number(g.indicator.weight) || 1;
            iwsumAll += iw; // every active indicator is in the denominator
            if (s.pct != null) { iwnum += s.pct * iw; anyInd = true; } // unscored indicators contribute 0
        });
        return { total, scored, aiPending, low, pct: anyInd && iwsumAll > 0 ? Math.round(iwnum / iwsumAll) : null };
    }, [matrix]);

    const chip = (key, label, count) => (
        <button
            type="button" onClick={() => setFilter(key)}
            className="btn btn-sm"
            style={{
                background: filter === key ? 'var(--primary)' : '#fff',
                color: filter === key ? '#fff' : 'var(--gray-600)',
                border: '1px solid var(--gray-200)', fontSize: 12,
            }}
        >
            {label}{count != null ? ` (${count})` : ''}
        </button>
    );

    return (
        <div>
            <div className="card" style={{ padding: '18px 20px', marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">الفترة الزمنية *</label>
                        <select className="form-select" value={selPeriod} onChange={e => setSelPeriod(e.target.value)}>
                            <option value="">اختر فترة...</option>
                            {periods.map(p => <option key={p.id} value={p.id}>{p.label_ar || `${p.month}/${p.year}`}</option>)}
                        </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">القسم *</label>
                        <select className="form-select" value={selDept} onChange={e => setSelDept(e.target.value)}>
                            <option value="">اختر قسماً...</option>
                            {departments.map(d => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {selPeriod && selDept && selectedPeriod && !canEvaluate && (
                <div className="card" style={{ marginBottom: 16, padding: '12px 16px', background: '#fdf6e3', border: '1px solid #f0c674', color: '#8a6d1b', fontSize: 13 }}>
                    🔒 التقييم متاح فقط عندما تكون الفترة في حالة «{PERIOD_STATUS_LABEL[EVAL_STATE]}». الحالة الحالية: «{PERIOD_STATUS_LABEL[selectedPeriod.status] || selectedPeriod.status}» — العرض للاطّلاع فقط.
                </div>
            )}

            {loading && <div className="flex items-center justify-center" style={{ height: 120 }}><div className="spinner" /></div>}

            {/* Sticky summary + jump index + filters */}
            {!loading && selPeriod && selDept && matrix.length > 0 && (
                <div className="card" style={{ position: 'sticky', top: 0, zIndex: 5, marginBottom: 16, padding: '12px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
                        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 15 }}>النسبة الكلية:{' '}
                                <span style={{ color: overall.pct != null ? scoreColor(overall.pct) : 'var(--gray-400)' }}>
                                    {overall.pct != null ? `${overall.pct}%` : 'لم يُقيَّم بعد'}
                                </span>
                            </strong>
                            <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>مُقيَّم {overall.scored}/{overall.total}</span>
                            {overall.aiPending > 0 && <span className="badge" style={{ background: '#eef2ff', color: '#1a56db', fontSize: 11 }}>🤖 {overall.aiPending} بانتظار المراجعة</span>}
                            {overall.low > 0 && <span className="badge" style={{ background: '#fdf6e3', color: '#c27803', fontSize: 11 }}>⚠ {overall.low} ثقة منخفضة</span>}
                        </div>
                        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                            {(overall.aiPending + overall.low) > 0 && (
                                <button className="btn btn-sm" style={{ background: '#0e9f6e', color: '#fff' }} onClick={acceptAllAi} disabled={!canEvaluate || acceptingAll || jobRunning}>
                                    {acceptingAll ? 'جاري الاعتماد...' : `✓ اعتماد كل الآلي (${overall.aiPending + overall.low})`}
                                </button>
                            )}
                            <button className="btn btn-secondary btn-sm" onClick={runAllAi} disabled={!canEvaluate || jobRunning}>
                                {jobRunning ? `جاري التقييم الآلي... (${job.completed}/${job.total})` : '🤖 تقييم آلي للكل'}
                            </button>
                        </div>
                    </div>

                    {/* progress bar */}
                    <div style={{ height: 6, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden', margin: '10px 0' }}>
                        <div style={{ height: '100%', width: `${overall.total ? Math.round((overall.scored / overall.total) * 100) : 0}%`, background: 'var(--primary)', transition: 'width .3s' }} />
                    </div>

                    {/* live AI-job progress: reassures the user they can leave the page / minimize,
                        and warns them not to close the app while it runs */}
                    {jobRunning && (
                        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                            <div style={{ fontSize: 13, color: '#1a56db', fontWeight: 600 }}>
                                🤖 التقييم الآلي قيد التنفيذ — {job.completed}/{job.total}
                                {(() => { const cur = job.indicators.find(i => i.status === 'running'); return cur ? ` · ${cur.name_ar}` : ''; })()}
                            </div>
                            <div style={{ height: 5, background: '#dbe4ff', borderRadius: 3, overflow: 'hidden', margin: '6px 0' }}>
                                <div style={{ height: '100%', width: `${job.total ? Math.round((job.completed / job.total) * 100) : 0}%`, background: '#1a56db', transition: 'width .3s' }} />
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                                يمكنك الانتقال إلى صفحات أخرى أو تصغير النافذة؛ سيستمر التقييم في الخلفية. لكن لا تُغلق التطبيق حتى ينتهي.
                            </div>
                        </div>
                    )}

                    {/* filters */}
                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
                        <input
                            className="form-input" style={{ width: 220, fontSize: 13 }}
                            placeholder="🔍 بحث عن مؤشر أو معيار..."
                            value={q} onChange={e => setQ(e.target.value)}
                        />
                        {chip('all', 'الكل')}
                        {chip('unscored', 'غير مُقيَّم')}
                        {chip('ai', 'بانتظار المراجعة', overall.aiPending + overall.low || null)}
                        {chip('low', 'ثقة منخفضة', overall.low || null)}
                    </div>

                    {/* jump index */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {matrix.map(group => {
                            const s = indicatorStats(group);
                            return (
                                <button
                                    key={group.indicator.id} type="button" onClick={() => jumpTo(group.indicator.id)}
                                    title={`${group.indicator.name_ar} — مُقيَّم ${s.scored}/${s.total}${s.low ? ` · ${s.low} ثقة منخفضة` : ''}`}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220,
                                        background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 999,
                                        padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                                    }}
                                >
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS[s.worst].dot, flexShrink: 0 }} />
                                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.indicator.name_ar}</span>
                                    <span style={{ color: 'var(--gray-400)', flexShrink: 0 }}>{s.scored}/{s.total}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* accordion of indicators */}
            {!loading && selPeriod && selDept && matrix.map(group => {
                const s = indicatorStats(group);
                const visibleCriteria = group.criteria.filter(item => critVisible(group, item));
                if (filterActive && visibleCriteria.length === 0) return null; // hide non-matching indicators
                const isOpen = filterActive ? true : !!expanded[group.indicator.id];
                return (
                    <div key={group.indicator.id} ref={el => { cardRefs.current[group.indicator.id] = el; }} className="card" style={{ marginBottom: 12, scrollMarginTop: 210 }}>
                        <div
                            className="card-header" style={{ cursor: filterActive ? 'default' : 'pointer' }}
                            onClick={() => { if (!filterActive) setExpanded(prev => ({ ...prev, [group.indicator.id]: !prev[group.indicator.id] })); }}
                        >
                            <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                                {!filterActive && <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>{isOpen ? '▼' : '◀'}</span>}
                                <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS[s.worst].dot, flexShrink: 0 }} />
                                <span className="card-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.indicator.name_ar}</span>
                            </div>
                            <div className="flex items-center gap-3" style={{ flexShrink: 0 }}>
                                <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>مُقيَّم {s.scored}/{s.total}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: s.pct != null ? scoreColor(s.pct) : 'var(--gray-400)' }}>
                                    {s.pct != null ? `${s.pct}%` : '—'}
                                </span>
                                <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); runAi(group.indicator.id); }} disabled={!canEvaluate || jobRunning}>
                                    {busyIndicatorIds.has(group.indicator.id) ? 'جاري التقييم...' : '🤖 تقييم آلي'}
                                </button>
                            </div>
                        </div>

                        {isOpen && (
                            <div className="card-body" style={{ display: 'grid', gap: 12 }}>
                                {visibleCriteria.map(({ criterion, submission, evaluation }) => {
                                    const st = critStatus(evaluation);
                                    const hasAiTrace = !!evaluation?.ai_rationale;
                                    const isAi = st === 'ai' || st === 'low';
                                    return (
                                        <div key={criterion.id} style={{ padding: '12px 14px', background: 'var(--gray-50)', borderRadius: 8, border: `1px solid ${st === 'low' ? '#f0c674' : 'var(--gray-100)'}`, borderRight: `3px solid ${STATUS[st].dot}` }}>
                                            <div className="flex items-center justify-between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                                                <div style={{ fontSize: 14, fontWeight: 500 }}>
                                                    {criterion.name_ar} <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>({Math.round(criterion.weight * 100)}%)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="badge" style={{ background: '#fff', border: `1px solid ${STATUS[st].dot}`, color: STATUS[st].dot, fontSize: 11 }}>
                                                        {st === 'done' && hasAiTrace ? 'معتمد (ذكاء اصطناعي)' : STATUS[st].label}
                                                        {isAi && evaluation.ai_confidence != null ? ` · ثقة ${Math.round(Number(evaluation.ai_confidence) * 100)}%` : ''}
                                                    </span>
                                                    {evaluation?.score != null && (
                                                        <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(Number(evaluation.score) * 100) }}>{(Number(evaluation.score) * 100).toFixed(0)}%</span>
                                                    )}
                                                </div>
                                            </div>

                                            {hasAiTrace && (
                                                <details open={st === 'low'} style={{ marginBottom: 8 }}>
                                                    <summary style={{ fontSize: 12, color: '#1a56db', cursor: 'pointer' }}>🤖 تبرير الذكاء الاصطناعي</summary>
                                                    <p style={{ fontSize: 12, color: 'var(--gray-600)', marginTop: 6, whiteSpace: 'pre-wrap', background: '#eef2ff', padding: '8px 10px', borderRadius: 6 }}>{evaluation.ai_rationale}</p>
                                                </details>
                                            )}

                                            {submission?.notes && <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 8 }}>ملاحظة الممثل: {submission.notes}</p>}
                                            {submission?.documents?.length > 0 ? (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                                                    {submission.documents.map(doc => (
                                                        <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 6, padding: '4px 8px' }}>
                                                            <span>📄</span><span>{doc.file_name}</span><span style={{ color: 'var(--gray-400)' }}>{formatSize(doc.size_bytes)}</span>
                                                            <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px' }} onClick={() => download(doc)}>تنزيل</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 10 }}>لم يتم رفع أي مستندات لهذا المعيار</p>}

                                            <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
                                                {renderScoreInput(criterion)}
                                                <div className="flex items-center gap-2">
                                                    {isAi && (
                                                        <button className="btn btn-sm" style={{ background: '#0e9f6e', color: '#fff' }} onClick={() => acceptAi(criterion, evaluation, submission?.id)} disabled={!canEvaluate || savingId === criterion.id}>
                                                            ✓ اعتماد
                                                        </button>
                                                    )}
                                                    <button className="btn btn-primary btn-sm" onClick={() => saveRow(criterion, submission?.id)} disabled={!canEvaluate || savingId === criterion.id || !rowComplete(criterion) || !rowDirty(criterion, evaluation)}>
                                                        {savingId === criterion.id ? 'جاري الحفظ...' : (isAi ? 'تعديل وحفظ' : 'حفظ التقييم')}
                                                    </button>
                                                </div>
                                            </div>
                                            <textarea
                                                className="form-textarea" style={{ width: '100%', marginTop: 8, fontSize: 13 }}
                                                placeholder="ملاحظات المراجع (اختياري)..."
                                                value={rowState[criterion.id]?.notes || ''}
                                                onChange={e => updateRow(criterion.id, { notes: e.target.value })}
                                                disabled={!canEvaluate}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}

            {!loading && (!selPeriod || !selDept) && (
                <div className="empty-state" style={{ marginTop: 40 }}>
                    <div className="empty-state-icon">✔</div>
                    <h3>اختر الفترة والقسم</h3>
                    <p>لبدء المراجعة والتقييم، يرجى اختيار الفترة الزمنية والقسم من الأعلى</p>
                </div>
            )}
            {!loading && selPeriod && selDept && matrix.length === 0 && (
                <div className="empty-state"><h3>لا توجد مؤشرات لهذه الفترة</h3></div>
            )}
            {!loading && selPeriod && selDept && matrix.length > 0 && filterActive && matrix.every(g => g.criteria.filter(item => critVisible(g, item)).length === 0) && (
                <div className="empty-state"><h3>لا توجد معايير مطابقة للبحث</h3></div>
            )}
        </div>
    );
}
