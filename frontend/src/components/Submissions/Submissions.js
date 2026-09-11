import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { departmentsAPI, periodsAPI, submissionsAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import usePersistentState from '../../hooks/usePersistentState';

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Classify one criterion's submission from the rep's point of view.
function critStatus(submission) {
    const s = submission?.status;
    if (!submission || s === 'pending') return 'empty';
    if (s === 'needs_revision') return 'revision';
    if (s === 'reviewed') return 'reviewed';
    return 'submitted';
}

const STATUS = {
    empty: { dot: '#9ca3af', label: 'لم يُرفع' },
    submitted: { dot: '#1a56db', label: 'مُقدَّم' },
    revision: { dot: '#c27803', label: 'يحتاج تعديل' },
    reviewed: { dot: '#0e9f6e', label: 'تمت مراجعته' },
};

// Per-indicator rollup: how many criteria have evidence, plus the worst status for the index dot.
function indicatorStats(group) {
    let uploaded = 0, empty = 0, revision = 0;
    group.criteria.forEach(({ submission }) => {
        const st = critStatus(submission);
        if (st === 'empty') empty++; else uploaded++;
        if (st === 'revision') revision++;
    });
    const allReviewed = group.criteria.length > 0 && group.criteria.every(({ submission }) => critStatus(submission) === 'reviewed');
    const worst = revision ? 'revision' : (empty ? 'empty' : (allReviewed ? 'reviewed' : 'submitted'));
    return { total: group.criteria.length, uploaded, empty, revision, worst };
}

export default function Submissions() {
    const { user, can } = useAuth();
    const [searchParams] = useSearchParams();
    const [periods, setPeriods] = useState([]);
    const [departments, setDepartments] = useState([]);
    // Sticky across navigation: returning to this page keeps the last period/department
    // (a deep link's ?period=&department= still wins). See usePersistentState.
    const [selPeriod, setSelPeriod] = usePersistentState('subm:period', searchParams.get('period'));
    const [selDept, setSelDept] = usePersistentState('subm:department', searchParams.get('department'));
    const [matrix, setMatrix] = useState([]);
    const [rowState, setRowState] = useState({}); // criterion_id -> { notes, files }
    const [savingId, setSavingId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState({}); // indicator_id -> bool
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState('all'); // all | empty | revision
    const cardRefs = useRef({});

    useEffect(() => {
        periodsAPI.list().then(r => {
            const ps = r.data.periods || [];
            setPeriods(ps);
            // Keep a valid remembered/deep-linked period; otherwise fall back to the latest.
            setSelPeriod(cur => (cur && ps.some(p => p.id === cur)) ? cur : (ps[0]?.id || ''));
        }).catch(() => {});
        departmentsAPI.list().then(r => {
            const all = r.data.departments || [];
            const mine = can('admin', 'qc_head') ? all : all.filter(d => d.representatives?.some(rep => rep.id === user.id));
            setDepartments(mine);
            // Keep a valid remembered department; else auto-pick when the user has exactly one.
            setSelDept(cur => (cur && mine.some(d => d.id === cur)) ? cur : (mine.length === 1 ? mine[0].id : ''));
        }).catch(() => {});
    }, []);

    const loadMatrix = useCallback(() => {
        if (!selPeriod || !selDept) { setMatrix([]); return; }
        setLoading(true);
        submissionsAPI.matrix({ period_id: selPeriod, department_id: selDept })
            .then(r => {
                const m = r.data.matrix || [];
                setMatrix(m);
                const rs = {};
                m.forEach(group => group.criteria.forEach(({ criterion, submission }) => {
                    rs[criterion.id] = { notes: submission?.notes || '', files: [] };
                }));
                setRowState(rs);
                setExpanded({}); // all indicators collapsed by default; the index + filters drive navigation
            })
            .catch(err => { toast.error(err.response?.data?.error || 'تعذر تحميل البيانات'); setMatrix([]); })
            .finally(() => setLoading(false));
    }, [selPeriod, selDept]);

    useEffect(() => { loadMatrix(); }, [loadMatrix]);

    const updateRow = (criterionId, patch) => setRowState(prev => ({ ...prev, [criterionId]: { ...prev[criterionId], ...patch } }));

    // Replace one criterion's submission in local state (no full reload → no flash, accordions
    // stay put, and unsaved edits in other rows survive).
    const patchSubmission = (criterionId, submission) => {
        setMatrix(prev => prev.map(g => ({
            ...g,
            criteria: g.criteria.map(item => (item.criterion.id === criterionId ? { ...item, submission } : item)),
        })));
    };

    const currentSubmission = (criterionId) => matrix.flatMap(g => g.criteria).find(i => i.criterion.id === criterionId)?.submission || null;

    // Enable "save" only when there is something to persist (new files or a changed note).
    const rowDirty = (criterion, submission) => {
        const st = rowState[criterion.id] || {};
        if (st.files && st.files.length) return true;
        return String(st.notes || '') !== String(submission?.notes || '');
    };

    const saveRow = async (criterionId, submissionId) => {
        const state = rowState[criterionId] || {};
        setSavingId(criterionId);
        try {
            const { data } = await submissionsAPI.save({ period_id: selPeriod, department_id: selDept, criterion_id: criterionId, notes: state.notes });
            let docs = currentSubmission(criterionId)?.documents || [];
            if (state.files?.length) {
                const fd = new FormData();
                state.files.forEach(f => fd.append('files', f));
                const up = await submissionsAPI.uploadDocuments(data.submission.id, fd);
                docs = [...docs, ...(up.data.documents || [])];
            }
            const submission = { ...data.submission, documents: docs };
            patchSubmission(criterionId, submission);
            updateRow(criterionId, { notes: submission.notes || '', files: [] });
            toast.success('تم الحفظ');
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ في الحفظ'); }
        finally { setSavingId(null); }
    };

    const download = async (doc) => {
        try {
            const res = await submissionsAPI.downloadDocument(doc.id);
            const url = URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a'); a.href = url; a.download = doc.file_name; a.click();
            URL.revokeObjectURL(url);
        } catch { toast.error('تعذر تنزيل الملف'); }
    };

    const removeDoc = async (criterionId, docId) => {
        if (!window.confirm('حذف هذا الملف؟')) return;
        try {
            await submissionsAPI.deleteDocument(docId);
            const sub = currentSubmission(criterionId);
            if (sub) patchSubmission(criterionId, { ...sub, documents: (sub.documents || []).filter(d => d.id !== docId) });
            toast.success('تم الحذف');
        } catch { toast.error('خطأ في الحذف'); }
    };

    const jumpTo = (indicatorId) => {
        setExpanded(prev => ({ ...prev, [indicatorId]: true }));
        requestAnimationFrame(() => cardRefs.current[indicatorId]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    const query = q.trim().toLowerCase();
    const critVisible = (group, item) => {
        const st = critStatus(item.submission);
        if (filter === 'empty' && st !== 'empty') return false;
        if (filter === 'revision' && st !== 'revision') return false;
        if (query) {
            const hay = `${item.criterion.name_ar} ${group.indicator.name_ar}`.toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    };
    const filterActive = filter !== 'all' || query !== '';

    const overall = useMemo(() => {
        let total = 0, uploaded = 0, empty = 0, revision = 0;
        matrix.forEach(g => { const s = indicatorStats(g); total += s.total; uploaded += s.uploaded; empty += s.empty; revision += s.revision; });
        return { total, uploaded, empty, revision };
    }, [matrix]);

    const chip = (key, label, count) => (
        <button
            type="button" onClick={() => setFilter(key)} className="btn btn-sm"
            style={{ background: filter === key ? 'var(--primary)' : '#fff', color: filter === key ? '#fff' : 'var(--gray-600)', border: '1px solid var(--gray-200)', fontSize: 12 }}
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

            {loading && <div className="flex items-center justify-center" style={{ height: 120 }}><div className="spinner" /></div>}

            {/* Sticky summary + jump index + filters */}
            {!loading && selPeriod && selDept && matrix.length > 0 && (
                <div className="card" style={{ position: 'sticky', top: 0, zIndex: 5, marginBottom: 16, padding: '12px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 15 }}>الإنجاز: <span style={{ color: 'var(--primary)' }}>{overall.uploaded}/{overall.total}</span></strong>
                        {overall.empty > 0 && <span className="badge" style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11 }}>◻ {overall.empty} لم يُرفع</span>}
                        {overall.revision > 0 && <span className="badge" style={{ background: '#fdf6e3', color: '#c27803', fontSize: 11 }}>⚠ {overall.revision} يحتاج تعديل</span>}
                    </div>

                    <div style={{ height: 6, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden', margin: '10px 0' }}>
                        <div style={{ height: '100%', width: `${overall.total ? Math.round((overall.uploaded / overall.total) * 100) : 0}%`, background: 'var(--primary)', transition: 'width .3s' }} />
                    </div>

                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
                        <input className="form-input" style={{ width: 220, fontSize: 13 }} placeholder="🔍 بحث عن مؤشر أو معيار..." value={q} onChange={e => setQ(e.target.value)} />
                        {chip('all', 'الكل')}
                        {chip('empty', 'لم يُرفع', overall.empty || null)}
                        {chip('revision', 'يحتاج تعديل', overall.revision || null)}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {matrix.map(group => {
                            const s = indicatorStats(group);
                            return (
                                <button
                                    key={group.indicator.id} type="button" onClick={() => jumpTo(group.indicator.id)}
                                    title={`${group.indicator.name_ar} — مُرفوع ${s.uploaded}/${s.total}${s.revision ? ` · ${s.revision} يحتاج تعديل` : ''}`}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220, background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}
                                >
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS[s.worst].dot, flexShrink: 0 }} />
                                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.indicator.name_ar}</span>
                                    <span style={{ color: 'var(--gray-400)', flexShrink: 0 }}>{s.uploaded}/{s.total}</span>
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
                if (filterActive && visibleCriteria.length === 0) return null;
                const isOpen = filterActive ? true : !!expanded[group.indicator.id];
                return (
                    <div key={group.indicator.id} ref={el => { cardRefs.current[group.indicator.id] = el; }} className="card" style={{ marginBottom: 12, scrollMarginTop: 200 }}>
                        <div
                            className="card-header" style={{ cursor: filterActive ? 'default' : 'pointer' }}
                            onClick={() => { if (!filterActive) setExpanded(prev => ({ ...prev, [group.indicator.id]: !prev[group.indicator.id] })); }}
                        >
                            <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                                {!filterActive && <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>{isOpen ? '▼' : '◀'}</span>}
                                <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS[s.worst].dot, flexShrink: 0 }} />
                                <span className="card-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.indicator.name_ar}</span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--gray-500)', flexShrink: 0 }}>مُرفوع {s.uploaded}/{s.total}</span>
                        </div>

                        {isOpen && (
                            <div className="card-body" style={{ display: 'grid', gap: 12 }}>
                                {visibleCriteria.map(({ criterion, submission }) => {
                                    const state = rowState[criterion.id] || {};
                                    const st = critStatus(submission);
                                    return (
                                        <div key={criterion.id} style={{ padding: '12px 14px', background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--gray-100)', borderRight: `3px solid ${STATUS[st].dot}` }}>
                                            <div className="flex items-center justify-between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                                                <div style={{ fontSize: 14, fontWeight: 500 }}>
                                                    {criterion.name_ar} <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>({Math.round(criterion.weight * 100)}%)</span>
                                                </div>
                                                <span className="badge" style={{ background: '#fff', border: `1px solid ${STATUS[st].dot}`, color: STATUS[st].dot, fontSize: 11 }}>{STATUS[st].label}</span>
                                            </div>
                                            <textarea
                                                className="form-textarea" style={{ width: '100%', marginBottom: 8, fontSize: 13 }}
                                                placeholder="ملاحظات توضيحية (اختياري)..."
                                                value={state.notes || ''}
                                                onChange={e => updateRow(criterion.id, { notes: e.target.value })}
                                            />
                                            {submission?.documents?.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                                                    {submission.documents.map(doc => (
                                                        <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 6, padding: '4px 8px' }}>
                                                            <span>📄</span>
                                                            <span>{doc.file_name}</span>
                                                            <span style={{ color: 'var(--gray-400)' }}>{formatSize(doc.size_bytes)}</span>
                                                            <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px' }} onClick={() => download(doc)}>تنزيل</button>
                                                            <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px', color: 'var(--danger)' }} onClick={() => removeDoc(criterion.id, doc.id)}>حذف</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                                                <input
                                                    key={`file-${criterion.id}-${submission?.documents?.length || 0}`}
                                                    type="file" multiple onChange={e => updateRow(criterion.id, { files: Array.from(e.target.files || []) })} style={{ fontSize: 12 }}
                                                />
                                                <button className="btn btn-primary btn-sm" onClick={() => saveRow(criterion.id, submission?.id)} disabled={savingId === criterion.id || !rowDirty(criterion, submission)}>
                                                    {savingId === criterion.id ? 'جاري الحفظ...' : 'حفظ'}
                                                </button>
                                            </div>
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
                    <div className="empty-state-icon">⇪</div>
                    <h3>اختر الفترة والقسم</h3>
                    <p>لبدء رفع المستندات، يرجى اختيار الفترة الزمنية والقسم من الأعلى</p>
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
