import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { indicatorsAPI } from '../../utils/api';

const TYPE_LABEL = { checklist: 'قائمة تحقق', percentage: 'نسبة مئوية', ratio: 'نسبة (بسط/مقام)', score_100: 'درجة من 100' };
const emptyCriterion = () => ({ name_ar: '', criterion_type: 'checklist', weight: 1 });

export default function Indicators() {
    const [indicators, setIndicators] = useState([]);
    const [expanded, setExpanded] = useState({});
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ code: '', name_ar: '', name_en: '', description_ar: '', criteria: [emptyCriterion()] });
    const [saving, setSaving] = useState(false);
    const [addingCriterionTo, setAddingCriterionTo] = useState(null);
    const [newCriterion, setNewCriterion] = useState(emptyCriterion());

    const load = () => indicatorsAPI.list().then(r => setIndicators(r.data.indicators || [])).catch(() => {});
    useEffect(() => { load(); }, []);

    const openAdd = () => { setForm({ code: '', name_ar: '', name_en: '', description_ar: '', criteria: [emptyCriterion()] }); setShowModal(true); };

    const updateCriterionRow = (i, patch) => setForm(f => ({ ...f, criteria: f.criteria.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
    const addCriterionRow = () => setForm(f => ({ ...f, criteria: [...f.criteria, emptyCriterion()] }));
    const removeCriterionRow = (i) => setForm(f => ({ ...f, criteria: f.criteria.filter((_, idx) => idx !== i) }));

    const save = async () => {
        if (!form.code || !form.name_ar) { toast.error('الرمز والاسم بالعربية مطلوبان'); return; }
        if (form.criteria.some(c => !c.name_ar)) { toast.error('كل معيار يحتاج اسماً'); return; }
        setSaving(true);
        try {
            await indicatorsAPI.create(form);
            toast.success('تم إنشاء المؤشر');
            await load();
            setShowModal(false);
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ'); }
        finally { setSaving(false); }
    };

    const toggleActive = async (ind) => {
        try { await indicatorsAPI.update(ind.id, { is_active: !ind.is_active }); await load(); toast.success(ind.is_active ? 'تم إلغاء تفعيل المؤشر' : 'تم تفعيل المؤشر'); }
        catch { toast.error('خطأ'); }
    };

    const addCriterion = async (indicatorId) => {
        if (!newCriterion.name_ar) { toast.error('اسم المعيار مطلوب'); return; }
        try {
            await indicatorsAPI.addCriterion(indicatorId, newCriterion);
            toast.success('تمت إضافة المعيار');
            await load();
            setAddingCriterionTo(null);
            setNewCriterion(emptyCriterion());
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ'); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>تعريف المؤشرات القابلة لإعادة الاستخدام ومعاييرها الموزونة</p>
                <button className="btn btn-primary" onClick={openAdd}>+ مؤشر جديد</button>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
                {indicators.map(ind => (
                    <div key={ind.id} className="card">
                        <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setExpanded(e => ({ ...e, [ind.id]: !e[ind.id] }))}>
                            <span className="card-title">{ind.name_ar} <span style={{ fontSize: 12, color: 'var(--gray-400)', fontWeight: 400 }}>({ind.criteria?.length || 0} معيار)</span></span>
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <span className={`badge ${ind.is_active ? 'badge-success' : 'badge-gray'}`}>{ind.is_active ? 'نشط' : 'غير نشط'}</span>
                                <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(ind)}>{ind.is_active ? 'إلغاء التفعيل' : 'تفعيل'}</button>
                            </div>
                        </div>
                        {expanded[ind.id] && (
                            <div className="card-body">
                                <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                                    {(ind.criteria || []).map(c => (
                                        <div key={c.id} className="flex items-center justify-between" style={{ padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
                                            <span style={{ fontSize: 13 }}>{c.name_ar}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="badge badge-gray">{TYPE_LABEL[c.criterion_type]}</span>
                                                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>وزن {Math.round(Number(c.weight) * 100)}%</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {addingCriterionTo === ind.id ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto auto', gap: 8, alignItems: 'center' }}>
                                        <input className="form-input" placeholder="اسم المعيار" value={newCriterion.name_ar} onChange={e => setNewCriterion(c => ({ ...c, name_ar: e.target.value }))} />
                                        <select className="form-select" value={newCriterion.criterion_type} onChange={e => setNewCriterion(c => ({ ...c, criterion_type: e.target.value }))}>
                                            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                        </select>
                                        <input type="number" step="0.1" className="form-input" placeholder="الوزن" value={newCriterion.weight} onChange={e => setNewCriterion(c => ({ ...c, weight: Number(e.target.value) }))} />
                                        <button className="btn btn-primary btn-sm" onClick={() => addCriterion(ind.id)}>حفظ</button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setAddingCriterionTo(null)}>إلغاء</button>
                                    </div>
                                ) : (
                                    <button className="btn btn-ghost btn-sm" onClick={() => { setAddingCriterionTo(ind.id); setNewCriterion(emptyCriterion()); }}>+ إضافة معيار</button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
                {indicators.length === 0 && <div className="empty-state"><p>لا توجد مؤشرات بعد</p></div>}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
                        <div className="modal-header">
                            <span className="modal-title">مؤشر جديد</span>
                            <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <div className="modal-body" style={{ maxHeight: 480, overflowY: 'auto' }}>
                            <div className="form-grid-2">
                                <div className="form-group">
                                    <label className="form-label">الرمز *</label>
                                    <input className="form-input" style={{ direction: 'ltr' }} value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. program-accreditation" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">الاسم بالعربية *</label>
                                    <input className="form-input" value={form.name_ar} onChange={e => setForm(f => ({ ...f, name_ar: e.target.value }))} />
                                </div>
                                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                    <label className="form-label">الاسم بالإنجليزية</label>
                                    <input className="form-input" value={form.name_en} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} />
                                </div>
                                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                    <label className="form-label">الوصف (اختياري)</label>
                                    <textarea className="form-textarea" value={form.description_ar} onChange={e => setForm(f => ({ ...f, description_ar: e.target.value }))} />
                                </div>
                            </div>

                            <label className="form-label">المعايير</label>
                            <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
                                {form.criteria.map((c, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                                        <input className="form-input" placeholder="اسم المعيار" value={c.name_ar} onChange={e => updateCriterionRow(i, { name_ar: e.target.value })} />
                                        <select className="form-select" value={c.criterion_type} onChange={e => updateCriterionRow(i, { criterion_type: e.target.value })}>
                                            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                        </select>
                                        <input type="number" step="0.1" className="form-input" placeholder="الوزن" value={c.weight} onChange={e => updateCriterionRow(i, { weight: Number(e.target.value) })} />
                                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeCriterionRow(i)} disabled={form.criteria.length === 1}>حذف</button>
                                    </div>
                                ))}
                            </div>
                            <button className="btn btn-ghost btn-sm" onClick={addCriterionRow}>+ إضافة معيار آخر</button>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>إلغاء</button>
                            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
