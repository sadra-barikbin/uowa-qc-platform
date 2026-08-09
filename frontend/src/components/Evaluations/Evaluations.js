import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { departmentsAPI, periodsAPI, submissionsAPI, evaluationsAPI } from '../../utils/api';

const scoreColor = s => s >= 90 ? '#0e9f6e' : s >= 70 ? '#1a56db' : s >= 50 ? '#c27803' : '#e02424';

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Evaluations() {
    const [searchParams] = useSearchParams();
    const [periods, setPeriods] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [selPeriod, setSelPeriod] = useState(searchParams.get('period') || '');
    const [selDept, setSelDept] = useState(searchParams.get('department') || '');
    const [matrix, setMatrix] = useState([]);
    const [rowState, setRowState] = useState({}); // criterion_id -> { percent, numerator, denominator, notes }
    const [savingId, setSavingId] = useState(null);
    const [aiId, setAiId] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        periodsAPI.list().then(r => {
            const ps = r.data.periods || [];
            setPeriods(ps);
            if (!selPeriod && ps[0]) setSelPeriod(ps[0].id);
        }).catch(() => {});
        departmentsAPI.list().then(r => setDepartments(r.data.departments || [])).catch(() => {});
    }, []);

    const loadMatrix = useCallback(() => {
        if (!selPeriod || !selDept) { setMatrix([]); return; }
        setLoading(true);
        evaluationsAPI.matrix({ period_id: selPeriod, department_id: selDept })
            .then(r => {
                setMatrix(r.data.matrix || []);
                const rs = {};
                (r.data.matrix || []).forEach(group => group.criteria.forEach(({ criterion, evaluation }) => {
                    rs[criterion.id] = {
                        percent: evaluation?.score != null ? Math.round(Number(evaluation.score) * 100) : '',
                        numerator: evaluation?.raw_values?.numerator ?? '',
                        denominator: evaluation?.raw_values?.denominator ?? '',
                        notes: evaluation?.reviewer_notes || '',
                    };
                }));
                setRowState(rs);
            })
            .catch(err => { toast.error(err.response?.data?.error || 'تعذر تحميل البيانات'); setMatrix([]); })
            .finally(() => setLoading(false));
    }, [selPeriod, selDept]);

    useEffect(() => { loadMatrix(); }, [loadMatrix]);

    const updateRow = (criterionId, patch) => setRowState(prev => ({ ...prev, [criterionId]: { ...prev[criterionId], ...patch } }));

    const saveRow = async (criterion, submissionId) => {
        const state = rowState[criterion.id] || {};
        const payload = { period_id: selPeriod, department_id: selDept, criterion_id: criterion.id, submission_id: submissionId, reviewer_notes: state.notes };
        if (criterion.criterion_type === 'ratio') {
            if (state.numerator === '' || state.denominator === '') { toast.error('أدخل البسط والمقام'); return; }
            payload.raw_values = { numerator: Number(state.numerator), denominator: Number(state.denominator) };
        } else if (criterion.criterion_type === 'score_100') {
            if (state.percent === '') { toast.error('أدخل الدرجة'); return; }
            payload.score = Number(state.percent); // raw 0-100, backend divides
        } else {
            if (state.percent === '') { toast.error('أدخل النسبة'); return; }
            payload.score = Number(state.percent) / 100; // checklist / percentage: already a 0-1 fraction
        }
        setSavingId(criterion.id);
        try {
            await evaluationsAPI.save(payload);
            toast.success('تم حفظ التقييم');
            loadMatrix();
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ في الحفظ'); }
        finally { setSavingId(null); }
    };

    const runAi = async (indicatorId) => {
        setAiId(indicatorId);
        try {
            const r = await evaluationsAPI.ai({ period_id: selPeriod, department_id: selDept, indicator_id: indicatorId });
            const { evaluated = [], skipped = [] } = r.data;
            toast.success(`تقييم آلي: ${evaluated.length} معيار${skipped.length ? ` (تُخطّي ${skipped.length} بلا مستندات)` : ''}`);
            loadMatrix();
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ في التقييم الآلي'); }
        finally { setAiId(null); }
    };

    const download = async (doc) => {
        try {
            const res = await submissionsAPI.downloadDocument(doc.id);
            const url = URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a'); a.href = url; a.download = doc.file_name; a.click();
            URL.revokeObjectURL(url);
        } catch { toast.error('تعذر تنزيل الملف'); }
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
                        <input type="number" className="form-input" style={{ width: 100 }} value={state.numerator} onChange={e => updateRow(criterion.id, { numerator: e.target.value })} />
                    </div>
                    <div>
                        <label className="form-hint">{criterion.config?.denominator_label_ar || 'المقام'}</label>
                        <input type="number" className="form-input" style={{ width: 100 }} value={state.denominator} onChange={e => updateRow(criterion.id, { denominator: e.target.value })} />
                    </div>
                    {preview != null && <span style={{ fontSize: 13, fontWeight: 600, color: scoreColor(preview) }}>= {preview}%</span>}
                </div>
            );
        }
        if (criterion.criterion_type === 'checklist') {
            return (
                <select className="form-select" style={{ width: 'auto' }} value={state.percent} onChange={e => updateRow(criterion.id, { percent: e.target.value })}>
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
                    placeholder={criterion.criterion_type === 'score_100' ? '0-100' : '0-100%'}
                />
                <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', fontSize: 13 }}>%</span>
            </div>
        );
    };

    return (
        <div>
            <div className="card" style={{ padding: '18px 20px', marginBottom: 20 }}>
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

            {loading && <div className="flex items-center justify-between" style={{ height: 120 }}><div className="spinner" /></div>}

            {!loading && selPeriod && selDept && matrix.map(group => (
                <div key={group.indicator.id} className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                        <span className="card-title">{group.indicator.name_ar}</span>
                        <div className="flex items-center gap-3">
                            <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>وزن المؤشر: {Math.round(group.indicator.weight * 100)}%</span>
                            <button className="btn btn-secondary btn-sm" onClick={() => runAi(group.indicator.id)} disabled={aiId === group.indicator.id}>
                                {aiId === group.indicator.id ? 'جاري التقييم...' : '🤖 تقييم آلي'}
                            </button>
                        </div>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: 14 }}>
                        {group.criteria.map(({ criterion, submission, evaluation }) => (
                            <div key={criterion.id} style={{ padding: '12px 14px', background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--gray-100)' }}>
                                <div className="flex items-center justify-between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                                        {criterion.name_ar} <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>({Math.round(criterion.weight * 100)}%)</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {evaluation?.evaluation_method === 'ai' && (
                                            <span className="badge badge-primary" style={{ fontSize: 11 }}>
                                                🤖 آلي{evaluation.ai_confidence != null ? ` · ثقة ${Math.round(Number(evaluation.ai_confidence) * 100)}%` : ''}
                                            </span>
                                        )}
                                        {evaluation?.score != null && (
                                            <span style={{ fontSize: 13, fontWeight: 600, color: scoreColor(Number(evaluation.score) * 100) }}>{(Number(evaluation.score) * 100).toFixed(0)}%</span>
                                        )}
                                    </div>
                                </div>
                                {evaluation?.evaluation_method === 'ai' && evaluation?.ai_rationale && (
                                    <p style={{ fontSize: 12, color: 'var(--gray-600)', marginBottom: 8, whiteSpace: 'pre-wrap', background: '#eef2ff', padding: '8px 10px', borderRadius: 6 }}>
                                        🤖 {evaluation.ai_rationale}
                                    </p>
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
                                    <button className="btn btn-primary btn-sm" onClick={() => saveRow(criterion, submission?.id)} disabled={savingId === criterion.id}>
                                        {savingId === criterion.id ? 'جاري الحفظ...' : 'حفظ التقييم'}
                                    </button>
                                </div>
                                <textarea
                                    className="form-textarea" style={{ width: '100%', marginTop: 8, fontSize: 13 }}
                                    placeholder="ملاحظات المراجع (اختياري)..."
                                    value={rowState[criterion.id]?.notes || ''}
                                    onChange={e => updateRow(criterion.id, { notes: e.target.value })}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ))}

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
        </div>
    );
}
