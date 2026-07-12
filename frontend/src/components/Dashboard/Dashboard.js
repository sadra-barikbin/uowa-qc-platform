import React, { useState, useEffect } from 'react';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
    Chart as ChartJS, CategoryScale, LinearScale, BarElement,
    LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { dashboardAPI, periodsAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

const scoreColor = s => s >= 90 ? '#0e9f6e' : s >= 70 ? '#1a56db' : s >= 50 ? '#c27803' : '#e02424';
const scoreBadge = s => s >= 90 ? 'badge-success' : s >= 70 ? 'badge-primary' : s >= 50 ? 'badge-warning' : 'badge-danger';
const scoreLabel = s => s >= 90 ? 'ممتاز' : s >= 70 ? 'جيد' : s >= 50 ? 'متوسط' : 'ضعيف';
const pClass = s => s >= 90 ? 'good' : s >= 70 ? 'primary' : s >= 50 ? 'ok' : 'bad';

export default function Dashboard() {
    const navigate = useNavigate();
    const { can } = useAuth();
    const [summary, setSummary] = useState(null);
    const [trends, setTrends] = useState([]);
    const [periods, setPeriods] = useState([]);
    const [selPeriod, setSelPeriod] = useState('');
    const [indicatorScores, setIndicatorScores] = useState([]);
    const [pendingReviews, setPendingReviews] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        periodsAPI.list().then(r => {
            const ps = r.data.periods || [];
            setPeriods(ps);
            if (ps[0]) setSelPeriod(ps[0].id);
        }).catch(() => {});
        dashboardAPI.trends().then(r => setTrends(r.data.trends || [])).catch(() => {});
    }, []);

    useEffect(() => {
        if (!selPeriod) return;
        setLoading(true);
        const calls = [dashboardAPI.summary({ period_id: selPeriod }), dashboardAPI.indicatorScores({ period_id: selPeriod })];
        if (can('admin', 'qc_head')) calls.push(dashboardAPI.pendingReviews({ period_id: selPeriod }));
        Promise.all(calls)
            .then(([s, i, p]) => { setSummary(s.data); setIndicatorScores(i.data.indicators || []); setPendingReviews(p?.data?.pending_reviews ?? null); })
            .catch(() => toast.error('خطأ في تحميل البيانات'))
            .finally(() => setLoading(false));
    }, [selPeriod]);

    const depts = summary?.departments || [];
    const scored = depts.filter(d => d.score !== null);
    const top10 = [...scored].sort((a, b) => b.score - a.score).slice(0, 10);

    const barData = {
        labels: top10.map(d => (d.name_ar || '').substring(0, 12)),
        datasets: [{ label: 'نسبة الإنجاز %', data: top10.map(d => d.score), backgroundColor: top10.map(d => scoreColor(d.score) + 'cc'), borderColor: top10.map(d => scoreColor(d.score)), borderWidth: 1.5, borderRadius: 6 }],
    };
    const barOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#f3f4f6' } }, x: { ticks: { font: { size: 10 } }, grid: { display: false } } } };

    const lineData = {
        labels: trends.map(t => t.label),
        datasets: [{ label: 'متوسط الأداء', data: trends.map(t => t.avg), borderColor: '#1a56db', backgroundColor: 'rgba(26,86,219,.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#1a56db' }],
    };
    const lineOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#f3f4f6' } }, x: { grid: { display: false } } } };

    const distBuckets = [
        { label: 'ممتاز ≥90%', count: scored.filter(d => d.score >= 90).length, color: '#0e9f6e' },
        { label: 'جيد 70-89%', count: scored.filter(d => d.score >= 70 && d.score < 90).length, color: '#1a56db' },
        { label: 'متوسط 50-69%', count: scored.filter(d => d.score >= 50 && d.score < 70).length, color: '#c27803' },
        { label: 'ضعيف <50%', count: scored.filter(d => d.score < 50).length, color: '#e02424' },
    ];
    const doughnutData = { labels: distBuckets.map(b => b.label), datasets: [{ data: distBuckets.map(b => b.count), backgroundColor: distBuckets.map(b => b.color + 'cc'), borderColor: distBuckets.map(b => b.color), borderWidth: 2 }] };
    const doughnutOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } } }, cutout: '60%' };

    return (
        <div>
            <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div className="flex items-center gap-3">
                    <label style={{ fontSize: 14, fontWeight: 500 }}>الفترة الزمنية:</label>
                    <select className="form-select" style={{ width: 'auto' }} value={selPeriod} onChange={e => setSelPeriod(e.target.value)}>
                        {periods.map(p => <option key={p.id} value={p.id}>{p.label_ar || `${p.month}/${p.year}`}</option>)}
                    </select>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/analytics')}>التقارير والتصدير ←</button>
            </div>

            <div className="metric-grid">
                {[
                    { label: 'عدد الأقسام', value: summary?.summary?.total_departments ?? '—', sub: 'قسم وكلية نشطة', cls: 'primary' },
                    { label: 'متوسط الأداء الكلي', value: summary ? `${summary.summary.avg_score?.toFixed(1)}%` : '—', sub: scoreLabel(summary?.summary?.avg_score || 0), cls: 'success' },
                    { label: 'أقسام ممتازة ≥90%', value: summary?.summary?.excellent_count ?? '—', sub: 'من إجمالي الأقسام', cls: 'success' },
                    { label: 'تحتاج انتباهاً <50%', value: summary?.summary?.needs_attention_count ?? '—', sub: 'أداء ضعيف أو غير مُقيَّم', cls: 'danger' },
                    ...(can('admin', 'qc_head') ? [{ label: 'مستندات بانتظار المراجعة', value: pendingReviews ?? '—', sub: 'لهذه الفترة', cls: 'warning' }] : []),
                ].map((m, i) => (
                    <div key={i} className={`metric-card ${m.cls}`}>
                        <div className="metric-card-label">{m.label}</div>
                        <div className="metric-card-value">{m.value}</div>
                        <div className="metric-card-sub">{m.sub}</div>
                    </div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
                <div className="card">
                    <div className="card-header"><span className="card-title">أداء الأقسام (أعلى 10)</span></div>
                    <div className="card-body" style={{ height: 260 }}><Bar data={barData} options={barOpts} /></div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-title">توزيع مستويات الأداء</span></div>
                    <div className="card-body" style={{ height: 260 }}><Doughnut data={doughnutData} options={doughnutOpts} /></div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div className="card">
                    <div className="card-header"><span className="card-title">اتجاه الأداء (آخر فترات)</span></div>
                    <div className="card-body" style={{ height: 200 }}>
                        {trends.length > 0 ? <Line data={lineData} options={lineOpts} /> : <div className="empty-state" style={{ padding: 40 }}><p>لا توجد بيانات تاريخية بعد</p></div>}
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-title">نسبة الإنجاز حسب المؤشر</span></div>
                    <div className="card-body" style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {indicatorScores.map(c => (
                            <div key={c.id} style={{ marginBottom: 10 }}>
                                <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 3 }}>
                                    <span>{c.name_ar}</span>
                                    <span style={{ fontWeight: 600, color: scoreColor(c.avg_score) }}>{c.avg_score}%</span>
                                </div>
                                <div className="progress-bar"><div className={`progress-fill ${pClass(c.avg_score)}`} style={{ width: `${c.avg_score}%` }} /></div>
                            </div>
                        ))}
                        {indicatorScores.length === 0 && <p style={{ textAlign:'center', color:'var(--gray-400)', fontSize:13 }}>لا توجد تقييمات بعد لهذه الفترة</p>}
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <span className="card-title">جميع الأقسام والكليات</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate('/departments')}>عرض الكل</button>
                </div>
                <div className="table-wrap">
                    <table>
                        <thead><tr><th>#</th><th>الكلية / القسم</th><th>نسبة الإنجاز</th><th>المستوى</th><th>التقدم</th></tr></thead>
                        <tbody>
                            {depts.map((d, i) => (
                                <tr key={d.id} onClick={() => navigate(`/departments/${d.id}`)} style={{ cursor: 'pointer' }}>
                                    <td style={{ color: 'var(--gray-400)', fontSize: 12 }}>{i + 1}</td>
                                    <td>
                                        <div style={{ fontWeight: 500 }}>{d.name_ar}</div>
                                        {d.college && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{d.college.name_ar}</div>}
                                    </td>
                                    {d.score !== null ? (
                                        <>
                                            <td><strong style={{ color: scoreColor(d.score) }}>{d.score.toFixed(1)}%</strong></td>
                                            <td><span className={`badge ${scoreBadge(d.score)}`}>{scoreLabel(d.score)}</span></td>
                                            <td style={{ minWidth: 100 }}><div className="progress-bar"><div className={`progress-fill ${pClass(d.score)}`} style={{ width: `${d.score}%` }} /></div></td>
                                        </>
                                    ) : (
                                        <>
                                            <td style={{ color: 'var(--gray-400)' }}>—</td>
                                            <td><span className="badge badge-gray">لم يُقيَّم بعد</span></td>
                                            <td style={{ minWidth: 100 }}><div className="progress-bar" /></td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {depts.length === 0 && <div className="empty-state"><p>لا توجد بيانات للفترة المحددة</p></div>}
                </div>
            </div>
        </div>
    );
}
