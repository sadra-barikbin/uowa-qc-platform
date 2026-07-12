import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { departmentsAPI, periodsAPI, indicatorsAPI, evaluationsAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

const scoreColor = s => s >= 0.9 ? '#0e9f6e' : s >= 0.7 ? '#1a56db' : s >= 0.5 ? '#c27803' : '#e02424';

export default function DepartmentDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, can } = useAuth();
    const [dept, setDept] = useState(null);
    const [periods, setPeriods] = useState([]);
    const [selPeriod, setSelPeriod] = useState('');
    const [indicators, setIndicators] = useState([]);
    const [indicatorScores, setIndicatorScores] = useState([]);
    const [finalScore, setFinalScore] = useState(null);

    useEffect(() => {
        departmentsAPI.get(id).then(r => setDept(r.data.department)).catch(() => navigate('/departments'));
        periodsAPI.list().then(r => { const ps = r.data.periods || []; setPeriods(ps); if (ps[0]) setSelPeriod(ps[0].id); }).catch(() => {});
        indicatorsAPI.list().then(r => setIndicators(r.data.indicators || [])).catch(() => {});
    }, [id]);

    useEffect(() => {
        if (!selPeriod) return;
        evaluationsAPI.scoresIndicators({ period_id: selPeriod, department_id: id }).then(r => setIndicatorScores(r.data.scores || [])).catch(() => setIndicatorScores([]));
        evaluationsAPI.scoresDepartments({ period_id: selPeriod }).then(r => {
            const row = (r.data.scores || []).find(s => s.department_id === id);
            setFinalScore(row?.final_score != null ? Number(row.final_score) : null);
        }).catch(() => setFinalScore(null));
    }, [id, selPeriod]);

    const isMyDept = user?.role === 'dept_rep' && dept?.representatives?.some(r => r.id === user.id);

    const scoreByIndicator = {};
    indicatorScores.forEach(s => { scoreByIndicator[s.indicator_id] = s; });
    const rows = indicators
        .map(ind => ({ indicator: ind, row: scoreByIndicator[ind.id] }))
        .filter(({ row }) => row); // only indicators active for this period have a row

    const totalScored = rows.filter(({ row }) => row.score !== null).length;
    const totalMissing = rows.length - totalScored;

    if (!dept) return <div className="flex items-center justify-between" style={{ height: 200 }}><div className="spinner" /></div>;

    return (
        <div>
            <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div className="flex items-center gap-3">
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate('/departments')}>← رجوع</button>
                    <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{dept.name_ar}</h2>
                        <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>{dept.college?.name_ar}</p>
                    </div>
                </div>
                {(isMyDept || can('admin', 'qc_head')) && (
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => navigate(can('admin', 'qc_head') ? `/evaluations?period=${selPeriod}&department=${id}` : `/submissions?period=${selPeriod}&department=${id}`)}
                    >
                        {can('admin', 'qc_head') ? 'مراجعة وتقييم' : 'رفع المستندات'}
                    </button>
                )}
            </div>

            <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
                <div className="metric-card primary">
                    <div className="metric-card-label">التقييم النهائي</div>
                    <div className="metric-card-value" style={{ color: finalScore != null ? scoreColor(finalScore) : 'var(--gray-400)' }}>
                        {finalScore != null ? `${(finalScore * 100).toFixed(1)}%` : 'لم يُقيَّم بعد'}
                    </div>
                </div>
                <div className="metric-card"><div className="metric-card-label">مؤشرات مُقيَّمة</div><div className="metric-card-value">{totalScored}</div></div>
                <div className="metric-card"><div className="metric-card-label">مؤشرات بلا تقييم</div><div className="metric-card-value" style={{ color: totalMissing > 0 ? 'var(--danger)' : undefined }}>{totalMissing}</div></div>
            </div>

            <div className="flex items-center gap-3 mb-4">
                <label style={{ fontSize: 14, fontWeight: 500 }}>الفترة:</label>
                <select className="form-select" style={{ width: 'auto' }} value={selPeriod} onChange={e => setSelPeriod(e.target.value)}>
                    {periods.map(p => <option key={p.id} value={p.id}>{p.label_ar || `${p.month}/${p.year}`}</option>)}
                </select>
            </div>

            <div className="card">
                <div className="card-header"><span className="card-title">نسبة الإنجاز حسب المؤشر</span></div>
                <div className="table-wrap">
                    <table>
                        <thead><tr><th>المؤشر</th><th>الإنجاز</th><th>التقدم</th><th>المعايير المُقيَّمة</th></tr></thead>
                        <tbody>
                            {rows.map(({ indicator, row }) => (
                                <tr key={indicator.id}>
                                    <td>{indicator.name_ar}</td>
                                    <td style={{ fontWeight: 600, color: row.score !== null ? scoreColor(Number(row.score)) : 'var(--gray-400)' }}>
                                        {row.score !== null ? `${(Number(row.score) * 100).toFixed(0)}%` : 'غير مُقيَّم'}
                                    </td>
                                    <td style={{ minWidth: 100 }}>
                                        <div className="progress-bar"><div className="progress-fill primary" style={{ width: `${row.score !== null ? Number(row.score) * 100 : 0}%` }} /></div>
                                    </td>
                                    <td style={{ fontSize: 13, color: 'var(--gray-500)' }}>{row.criteria_scored}/{row.criteria_total}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {rows.length === 0 && <div className="empty-state"><div className="empty-state-icon">✎</div><h3>لا توجد مؤشرات لهذه الفترة</h3><p>لم يتم تفعيل أي مؤشر لهذا القسم في الفترة المحددة</p></div>}
        </div>
    );
}
