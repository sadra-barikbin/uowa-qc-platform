import React, { useState, useEffect } from 'react';
import { Bar, Radar } from 'react-chartjs-2';
import { Chart as ChartJS, RadialLinearScale, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Tooltip, Legend } from 'chart.js';
import toast from 'react-hot-toast';
import { reportsAPI, periodsAPI, dashboardAPI } from '../../utils/api';

ChartJS.register(RadialLinearScale, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Tooltip, Legend);

// Pull the server's Content-Disposition filename (prefer the UTF-8 `filename*` form for the
// Arabic period label) so the download matches what the backend named it, not a generic report.xlsx.
function filenameFromResponse(res, fallback) {
    const cd = res.headers?.['content-disposition'];
    if (!cd) return fallback;
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    return plain ? plain[1] : fallback;
}

export default function Analytics() {
    const [periods, setPeriods] = useState([]);
    const [period1, setPeriod1] = useState('');
    const [period2, setPeriod2] = useState('');
    const [comparison, setComparison] = useState([]);
    const [catScores, setCatScores] = useState([]);
    const [exporting, setExporting] = useState('');
    const [selPeriod, setSelPeriod] = useState('');

    useEffect(() => {
        periodsAPI.list().then(r => {
            const ps = r.data.periods || [];
            setPeriods(ps);
            if (ps[0]) { setPeriod1(ps[0].id); setSelPeriod(ps[0].id); }
            if (ps[1]) setPeriod2(ps[1].id);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!selPeriod) return;
        dashboardAPI.indicatorScores({ period_id: selPeriod }).then(r => setCatScores(r.data.indicators || [])).catch(() => {});
    }, [selPeriod]);

    const runComparison = async () => {
        if (!period1 || !period2) { toast.error('اختر فترتين للمقارنة'); return; }
        try {
            const r = await reportsAPI.comparison({ period1_id: period1, period2_id: period2 });
            setComparison(r.data.comparison || []);
        } catch { toast.error('خطأ في المقارنة'); }
    };

    const exportFile = async (type) => {
        if (!selPeriod) { toast.error('اختر فترة زمنية'); return; }
        setExporting(type);
        try {
            const fn = type === 'excel' ? reportsAPI.exportExcel : reportsAPI.exportPDF;
            const res = await fn({ period_id: selPeriod });
            const ext = type === 'excel' ? 'xlsx' : 'pdf';
            const url = URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a'); a.href = url; a.download = filenameFromResponse(res, `report.${ext}`); a.click();
            URL.revokeObjectURL(url);
            toast.success('تم التصدير بنجاح');
        } catch { toast.error('خطأ في التصدير'); }
        finally { setExporting(''); }
    };

    const radarData = {
        labels: catScores.map(c => c.name_ar?.substring(0, 12)),
        datasets: [{ label: 'متوسط الأداء', data: catScores.map(c => c.avg_score), backgroundColor: 'rgba(26,86,219,.12)', borderColor: '#1a56db', borderWidth: 2, pointBackgroundColor: '#1a56db', pointRadius: 4 }],
    };
    const radarOpts = { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 10 } } } }, plugins: { legend: { display: false } } };

    const compData = comparison.slice(0, 15);
    const barCompData = {
        labels: compData.map(c => c.department?.name_ar?.substring(0, 10)),
        datasets: [
            { label: 'الفترة الأولى', data: compData.map(c => c.period1_score), backgroundColor: '#1a56dbcc', borderRadius: 4 },
            { label: 'الفترة الثانية', data: compData.map(c => c.period2_score), backgroundColor: '#0e9f6ecc', borderRadius: 4 },
        ],
    };
    const barCompOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { min: 0, max: 100 } } };

    return (
        <div>
            {/* Export controls */}
            <div className="card" style={{ padding: '18px 20px', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">الفترة الزمنية للتقرير</label>
                        <select className="form-select" style={{ width: 'auto' }} value={selPeriod} onChange={e => setSelPeriod(e.target.value)}>
                            {periods.map(p => <option key={p.id} value={p.id}>{p.label_ar || `${p.month}/${p.year}`}</option>)}
                        </select>
                    </div>
                    <button className="btn btn-success" onClick={() => exportFile('excel')} disabled={exporting === 'excel'}>
                        {exporting === 'excel' ? 'جاري...' : 'تصدير Excel'}
                    </button>
                    <button className="btn btn-danger" onClick={() => exportFile('pdf')} disabled={exporting === 'pdf'}>
                        {exporting === 'pdf' ? 'جاري...' : 'تصدير PDF'}
                    </button>
                </div>
            </div>

            {/* Radar chart */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div className="card">
                    <div className="card-header"><span className="card-title">الرادار — أداء المؤشرات</span></div>
                    <div className="card-body" style={{ height: 280 }}>
                        {catScores.length > 0 ? <Radar data={radarData} options={radarOpts} /> : <div className="empty-state" style={{ padding: 40 }}><p>اختر فترة زمنية</p></div>}
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-title">ترتيب المؤشرات (أعلى إلى أدنى)</span></div>
                    <div className="card-body" style={{ maxHeight: 280, overflowY: 'auto' }}>
                        {[...catScores].sort((a, b) => b.avg_score - a.avg_score).map((c, i) => (
                            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', minWidth: 20, textAlign: 'center' }}>{i + 1}</span>
                                <span style={{ fontSize: 13, flex: 1 }}>{c.name_ar}</span>
                                <span style={{ fontSize: 13, fontWeight: 600, color: c.avg_score >= 70 ? '#0e9f6e' : c.avg_score >= 50 ? '#c27803' : '#e02424' }}>{c.avg_score}%</span>
                                <div style={{ width: 80, height: 6, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${c.avg_score}%`, background: c.avg_score >= 70 ? '#0e9f6e' : c.avg_score >= 50 ? '#c27803' : '#e02424', borderRadius: 3 }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Period comparison */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                    <span className="card-title">المقارنة بين فترتين</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select className="form-select" style={{ width: 'auto', fontSize: 13 }} value={period1} onChange={e => setPeriod1(e.target.value)}>
                            {periods.map(p => <option key={p.id} value={p.id}>{p.label_ar || `${p.month}/${p.year}`}</option>)}
                        </select>
                        <span style={{ fontSize: 13 }}>vs</span>
                        <select className="form-select" style={{ width: 'auto', fontSize: 13 }} value={period2} onChange={e => setPeriod2(e.target.value)}>
                            {periods.map(p => <option key={p.id} value={p.id}>{p.label_ar || `${p.month}/${p.year}`}</option>)}
                        </select>
                        <button className="btn btn-primary btn-sm" onClick={runComparison}>مقارنة</button>
                    </div>
                </div>
                {comparison.length > 0 ? (
                    <>
                        <div className="card-body" style={{ height: 280 }}><Bar data={barCompData} options={barCompOpts} /></div>
                        <div className="table-wrap">
                            <table>
                                <thead><tr><th>القسم</th><th>الفترة الأولى</th><th>الفترة الثانية</th><th>التغيير</th></tr></thead>
                                <tbody>
                                    {comparison.map(c => (
                                        <tr key={c.department?.id}>
                                            <td>{c.department?.name_ar}</td>
                                            <td>{c.period1_score != null ? `${c.period1_score}%` : '—'}</td>
                                            <td>{c.period2_score != null ? `${c.period2_score}%` : '—'}</td>
                                            <td style={{ fontWeight: 600, color: c.change == null ? 'var(--gray-400)' : c.change >= 0 ? '#0e9f6e' : '#e02424' }}>
                                                {c.change == null ? '—' : `${c.change >= 0 ? '+' : ''}${c.change}%`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                ) : (
                    <div className="empty-state" style={{ padding: 40 }}><p>اختر فترتين واضغط مقارنة</p></div>
                )}
            </div>
        </div>
    );
}
