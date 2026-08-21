import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { periodsAPI, indicatorsAPI } from '../../utils/api';

const STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة للرفع', under_review: 'قيد المراجعة', published: 'منشورة', closed: 'مغلقة' };
const STATUS_BADGE = { draft: 'badge-gray', open: 'badge-primary', under_review: 'badge-warning', published: 'badge-success', closed: 'badge-gray' };
const STATUSES = Object.keys(STATUS_LABEL);
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export default function Periods() {
    const [periods, setPeriods] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, label_ar: '', label_en: '', submission_deadline: '', clone_from_period_id: '' });
    const [saving, setSaving] = useState(false);
    const [indicatorsPeriod, setIndicatorsPeriod] = useState(null);
    const [allIndicators, setAllIndicators] = useState([]);
    const [indicatorRows, setIndicatorRows] = useState([]);
    const [savingIndicators, setSavingIndicators] = useState(false);

    const load = () => periodsAPI.list().then(r => setPeriods(r.data.periods || [])).catch(() => {});
    useEffect(() => { load(); }, []);

    const openAdd = () => {
        setForm({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, label_ar: '', label_en: '', submission_deadline: '', clone_from_period_id: '' });
        setShowModal(true);
    };

    const save = async () => {
        if (!form.year || !form.month) { toast.error('السنة والشهر مطلوبان'); return; }
        setSaving(true);
        try {
            await periodsAPI.create({ ...form, clone_from_period_id: form.clone_from_period_id || undefined });
            toast.success('تم إنشاء الفترة');
            await load();
            setShowModal(false);
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ'); }
        finally { setSaving(false); }
    };

    const changeStatus = async (period, status) => {
        try { await periodsAPI.update(period.id, { status }); await load(); toast.success('تم تحديث الحالة'); }
        catch { toast.error('خطأ'); }
    };

    const openIndicators = async (period) => {
        setIndicatorsPeriod(period);
        const [periodRes, indicatorsRes] = await Promise.all([periodsAPI.get(period.id), indicatorsAPI.list()]);
        const active = periodRes.data.period.period_indicators || [];
        const catalog = indicatorsRes.data.indicators || [];
        setAllIndicators(catalog);
        setIndicatorRows(catalog.map(ind => {
            const match = active.find(pi => pi.indicator_id === ind.id);
            return { indicator_id: ind.id, weight: match ? Number(match.weight) : 1, is_active: !!match?.is_active };
        }));
    };

    const updateRow = (indicatorId, patch) => setIndicatorRows(rows => rows.map(r => r.indicator_id === indicatorId ? { ...r, ...patch } : r));

    const saveIndicators = async () => {
        setSavingIndicators(true);
        try {
            await periodsAPI.setIndicators(indicatorsPeriod.id, indicatorRows.map((r, i) => ({ ...r, sort_order: i })));
            toast.success('تم حفظ إعدادات المؤشرات');
            setIndicatorsPeriod(null);
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ'); }
        finally { setSavingIndicators(false); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>إدارة الفترات التقييمية الشهرية والمؤشرات المفعّلة لكل فترة</p>
                <button className="btn btn-primary" onClick={openAdd}>+ فترة جديدة</button>
            </div>

            <div className="card">
                <div className="table-wrap">
                    <table>
                        <thead><tr><th>الفترة</th><th>الحالة</th><th>موعد الرفع النهائي</th><th>إجراءات</th></tr></thead>
                        <tbody>
                            {periods.map(p => (
                                <tr key={p.id}>
                                    <td style={{ fontWeight: 500 }}>{p.label_ar || `${MONTHS_AR[p.month - 1]} ${p.year}`}</td>
                                    <td>
                                        <select className="form-select" style={{ width: 'auto', fontSize: 12 }} value={p.status} onChange={e => changeStatus(p, e.target.value)}>
                                            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                                        </select>
                                    </td>
                                    <td style={{ fontSize: 13, color: 'var(--gray-500)' }}>{p.submission_deadline ? new Date(p.submission_deadline).toLocaleDateString('ar-IQ') : '—'}</td>
                                    <td><button className="btn btn-ghost btn-sm" onClick={() => openIndicators(p)}>إدارة المؤشرات</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {periods.length === 0 && <div className="empty-state"><p>لا توجد فترات بعد</p></div>}
                </div>
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">فترة تقييمية جديدة</span>
                            <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-grid-2">
                                <div className="form-group">
                                    <label className="form-label">السنة *</label>
                                    <input type="number" className="form-input" value={form.year} onChange={e => setForm(f => ({ ...f, year: Number(e.target.value) }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">الشهر *</label>
                                    <select className="form-select" value={form.month} onChange={e => setForm(f => ({ ...f, month: Number(e.target.value) }))}>
                                        {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">التسمية بالعربية</label>
                                    <input className="form-input" value={form.label_ar} onChange={e => setForm(f => ({ ...f, label_ar: e.target.value }))} placeholder={`${MONTHS_AR[form.month - 1]} ${form.year}`} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">التسمية بالإنجليزية</label>
                                    <input className="form-input" value={form.label_en} onChange={e => setForm(f => ({ ...f, label_en: e.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">موعد الرفع النهائي</label>
                                    <input type="date" className="form-input" value={form.submission_deadline} onChange={e => setForm(f => ({ ...f, submission_deadline: e.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">نسخ المؤشرات من فترة سابقة (اختياري)</label>
                                    <select className="form-select" value={form.clone_from_period_id} onChange={e => setForm(f => ({ ...f, clone_from_period_id: e.target.value }))}>
                                        <option value="">— ابدأ بكل المؤشرات النشطة —</option>
                                        {periods.map(p => <option key={p.id} value={p.id}>{p.label_ar || `${p.month}/${p.year}`}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>إلغاء</button>
                            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'إنشاء'}</button>
                        </div>
                    </div>
                </div>
            )}

            {indicatorsPeriod && (
                <div className="modal-overlay" onClick={() => setIndicatorsPeriod(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                        <div className="modal-header">
                            <span className="modal-title">مؤشرات {indicatorsPeriod.label_ar}</span>
                            <button className="modal-close" onClick={() => setIndicatorsPeriod(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="flex items-center gap-3" style={{ padding: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', borderBottom: '2px solid var(--gray-200)' }}>
                                <span style={{ width: 40, textAlign: 'center' }}>مفعّل</span>
                                <span style={{ flex: 1 }}>المؤشر</span>
                                <span style={{ width: 80, textAlign: 'center' }}>الوزن</span>
                            </div>
                            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                                {allIndicators.map(ind => {
                                    const row = indicatorRows.find(r => r.indicator_id === ind.id);
                                    return (
                                        <div key={ind.id} className="flex items-center gap-3" style={{ padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
                                            <label style={{ width: 40, display: 'flex', justifyContent: 'center', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={row?.is_active || false} onChange={e => updateRow(ind.id, { is_active: e.target.checked })} />
                                            </label>
                                            <span style={{ flex: 1, fontSize: 13 }}>{ind.name_ar}</span>
                                            <input type="number" step="0.1" min="0" className="form-input" style={{ width: 80, textAlign: 'center' }} value={row?.weight ?? 1} onChange={e => updateRow(ind.id, { weight: Number(e.target.value) })} disabled={!row?.is_active} />
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 10 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', marginBottom: 12, textAlign: 'center' }}>كيف تُحتسب النسبة النهائية للقسم؟</div>
                                <div className="flex items-center justify-center gap-3" style={{ flexWrap: 'wrap', fontSize: 13, color: 'var(--gray-700)' }}>
                                    <span style={{ fontWeight: 600 }}>النسبة النهائية</span>
                                    <span style={{ fontSize: 20, color: 'var(--gray-400)' }}>=</span>
                                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', lineHeight: 1.5 }}>
                                        <span style={{ padding: '0 10px 6px' }}>مجموع ( درجة المؤشر × وزنه )</span>
                                        <span style={{ borderTop: '2px solid #043468', padding: '6px 10px 0', width: '100%' }}>مجموع الأوزان</span>
                                    </span>
                                </div>
                                <p style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 12, lineHeight: 1.7, textAlign: 'center' }}>
                                    الأوزان نسبية؛ ما يهم تناسبها لا قيمتها المطلقة — فالوزن <b>1</b> لكل المؤشرات يعني تساوي أهميتها. وإلغاء تفعيل مؤشر يستثنيه من الاحتساب.
                                </p>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setIndicatorsPeriod(null)}>إلغاء</button>
                            <button className="btn btn-primary" onClick={saveIndicators} disabled={savingIndicators}>{savingIndicators ? 'جاري الحفظ...' : 'حفظ'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
