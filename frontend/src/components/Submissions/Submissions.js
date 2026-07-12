import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { departmentsAPI, periodsAPI, submissionsAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

const STATUS_LABEL = { pending: 'لم يُرفع بعد', submitted: 'مُقدَّم', needs_revision: 'يحتاج تعديل', reviewed: 'تمت مراجعته' };
const STATUS_BADGE = { pending: 'badge-gray', submitted: 'badge-primary', needs_revision: 'badge-warning', reviewed: 'badge-success' };

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Submissions() {
    const { user, can } = useAuth();
    const [searchParams] = useSearchParams();
    const [periods, setPeriods] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [selPeriod, setSelPeriod] = useState(searchParams.get('period') || '');
    const [selDept, setSelDept] = useState(searchParams.get('department') || '');
    const [matrix, setMatrix] = useState([]);
    const [rowState, setRowState] = useState({}); // criterion_id -> { notes, files }
    const [savingId, setSavingId] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        periodsAPI.list().then(r => {
            const ps = r.data.periods || [];
            setPeriods(ps);
            if (!selPeriod && ps[0]) setSelPeriod(ps[0].id);
        }).catch(() => {});
        departmentsAPI.list().then(r => {
            const all = r.data.departments || [];
            const mine = can('admin', 'qc_head') ? all : all.filter(d => d.representatives?.some(rep => rep.id === user.id));
            setDepartments(mine);
            if (!selDept && mine.length === 1) setSelDept(mine[0].id);
        }).catch(() => {});
    }, []);

    const loadMatrix = useCallback(() => {
        if (!selPeriod || !selDept) { setMatrix([]); return; }
        setLoading(true);
        submissionsAPI.matrix({ period_id: selPeriod, department_id: selDept })
            .then(r => {
                setMatrix(r.data.matrix || []);
                const rs = {};
                (r.data.matrix || []).forEach(group => group.criteria.forEach(({ criterion, submission }) => {
                    rs[criterion.id] = { notes: submission?.notes || '', files: [] };
                }));
                setRowState(rs);
            })
            .catch(err => { toast.error(err.response?.data?.error || 'تعذر تحميل البيانات'); setMatrix([]); })
            .finally(() => setLoading(false));
    }, [selPeriod, selDept]);

    useEffect(() => { loadMatrix(); }, [loadMatrix]);

    const updateRow = (criterionId, patch) => setRowState(prev => ({ ...prev, [criterionId]: { ...prev[criterionId], ...patch } }));

    const saveRow = async (criterionId, submissionId) => {
        const state = rowState[criterionId] || {};
        setSavingId(criterionId);
        try {
            const { data } = await submissionsAPI.save({ period_id: selPeriod, department_id: selDept, criterion_id: criterionId, notes: state.notes });
            if (state.files?.length) {
                const fd = new FormData();
                state.files.forEach(f => fd.append('files', f));
                await submissionsAPI.uploadDocuments(data.submission.id, fd);
            }
            toast.success('تم الحفظ');
            loadMatrix();
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

    const removeDoc = async (docId) => {
        if (!window.confirm('حذف هذا الملف؟')) return;
        try { await submissionsAPI.deleteDocument(docId); toast.success('تم الحذف'); loadMatrix(); }
        catch { toast.error('خطأ في الحذف'); }
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
                    <div className="card-header"><span className="card-title">{group.indicator.name_ar}</span></div>
                    <div className="card-body" style={{ display: 'grid', gap: 14 }}>
                        {group.criteria.map(({ criterion, submission }) => {
                            const state = rowState[criterion.id] || {};
                            return (
                                <div key={criterion.id} style={{ padding: '12px 14px', background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--gray-100)' }}>
                                    <div className="flex items-center justify-between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                                        <div style={{ fontSize: 14, fontWeight: 500 }}>
                                            {criterion.name_ar} <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>({Math.round(criterion.weight * 100)}%)</span>
                                        </div>
                                        <span className={`badge ${STATUS_BADGE[submission?.status || 'pending']}`}>{STATUS_LABEL[submission?.status || 'pending']}</span>
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
                                                    <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px', color: 'var(--danger)' }} onClick={() => removeDoc(doc.id)}>حذف</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                                        <input type="file" multiple onChange={e => updateRow(criterion.id, { files: Array.from(e.target.files || []) })} style={{ fontSize: 12 }} />
                                        <button className="btn btn-primary btn-sm" onClick={() => saveRow(criterion.id, submission?.id)} disabled={savingId === criterion.id}>
                                            {savingId === criterion.id ? 'جاري الحفظ...' : 'حفظ'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

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
        </div>
    );
}
