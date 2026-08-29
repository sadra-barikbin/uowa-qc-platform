import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { indicatorsAPI } from '../../utils/api';

const TYPE_LABEL = { binary: 'ثنائي (نعم/لا)', checklist: 'قائمة تحقق', percentage: 'نسبة مئوية', ratio: 'نسبة (بسط/مقام)' };
const emptyCriterion = () => ({ name_ar: '', criterion_type: 'checklist', weight: 1, ai_guidance: '', checks: [], scoring_mode: 'fraction' });
const GUIDANCE_PLACEHOLDER = 'تعليمات التقييم الآلي (اختياري) — صف ما يجب أن يبحث عنه المُقيِّم الآلي في المستندات ومتى يمنح الدرجة الكاملة';

// Turn a criterion's flat form fields into the config payload the API stores.
const toConfig = (c) => {
    const cfg = {};
    if (c.ai_guidance && c.ai_guidance.trim()) cfg.ai_guidance = c.ai_guidance.trim();
    if (c.criterion_type === 'checklist') {
        const checks = (c.checks || []).map(s => (s || '').trim()).filter(Boolean);
        if (checks.length) { cfg.checks = checks; cfg.scoring_mode = c.scoring_mode === 'all' ? 'all' : 'fraction'; }
    }
    return cfg;
};

export default function Indicators() {
    const [indicators, setIndicators] = useState([]);
    const [expanded, setExpanded] = useState({});
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ code: '', name_ar: '', name_en: '', description_ar: '', criteria: [emptyCriterion()] });
    const [saving, setSaving] = useState(false);
    const [addingCriterionTo, setAddingCriterionTo] = useState(null);
    const [newCriterion, setNewCriterion] = useState(emptyCriterion());
    const [editingCriterion, setEditingCriterion] = useState(null); // criterion id being edited
    const [editValues, setEditValues] = useState(null);

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
            await indicatorsAPI.create({
                ...form,
                criteria: form.criteria.map(c => ({ name_ar: c.name_ar, criterion_type: c.criterion_type, weight: c.weight, config: toConfig(c) })),
            });
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
            await indicatorsAPI.addCriterion(indicatorId, { name_ar: newCriterion.name_ar, criterion_type: newCriterion.criterion_type, weight: newCriterion.weight, config: toConfig(newCriterion) });
            toast.success('تمت إضافة المعيار');
            await load();
            setAddingCriterionTo(null);
            setNewCriterion(emptyCriterion());
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ'); }
    };

    const startEditCriterion = (c) => { setEditingCriterion(c.id); setEditValues({ name_ar: c.name_ar, criterion_type: c.criterion_type, weight: Number(c.weight), ai_guidance: c.config?.ai_guidance || '', checks: Array.isArray(c.config?.checks) ? c.config.checks : [], scoring_mode: c.config?.scoring_mode === 'all' ? 'all' : 'fraction' }); };
    const cancelEditCriterion = () => { setEditingCriterion(null); setEditValues(null); };
    const saveEditCriterion = async () => {
        if (!editValues.name_ar) { toast.error('اسم المعيار مطلوب'); return; }
        try {
            await indicatorsAPI.updateCriterion(editingCriterion, { name_ar: editValues.name_ar, criterion_type: editValues.criterion_type, weight: editValues.weight, config: toConfig(editValues) });
            toast.success('تم تحديث المعيار');
            await load();
            cancelEditCriterion();
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ'); }
    };

    // Reusable name / type / weight row + AI-guidance textarea used by the create, add, and edit forms.
    const criterionFields = (c, patch, { onRemove, removeDisabled } = {}) => (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: onRemove ? '2fr 1fr 1fr auto' : '2fr 1fr 1fr', gap: 8, alignItems: 'center' }}>
                <input className="form-input" placeholder="اسم المعيار" value={c.name_ar} onChange={e => patch({ name_ar: e.target.value })} />
                <select className="form-select" value={c.criterion_type} onChange={e => patch({ criterion_type: e.target.value })}>
                    {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input type="number" step="0.1" className="form-input" placeholder="الوزن" value={c.weight} onChange={e => patch({ weight: Number(e.target.value) })} />
                {onRemove && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={onRemove} disabled={removeDisabled}>حذف</button>}
            </div>
            {c.criterion_type === 'checklist' && (() => {
                const checks = Array.isArray(c.checks) ? c.checks : [];
                const setChecks = next => patch({ checks: next });
                return (
                    <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 8 }}>بنود قائمة التحقق (اختياري)</div>
                        {checks.map((item, i) => (
                            <div key={i} className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                                <input className="form-input" style={{ fontSize: 13 }} placeholder={`البند ${i + 1}`} value={item} onChange={e => setChecks(checks.map((x, idx) => (idx === i ? e.target.value : x)))} />
                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setChecks(checks.filter((_, idx) => idx !== i))}>حذف</button>
                            </div>
                        ))}
                        <button className="btn btn-ghost btn-sm" onClick={() => setChecks([...checks, ''])}>+ إضافة بند</button>
                        {checks.length > 0 && (
                            <div className="flex items-center gap-3" style={{ marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}>
                                <span style={{ color: 'var(--gray-500)' }}>طريقة الاحتساب:</span>
                                <label style={{ cursor: 'pointer' }}><input type="radio" checked={(c.scoring_mode || 'fraction') === 'fraction'} onChange={() => patch({ scoring_mode: 'fraction' })} /> النسبة (المُحقَّق ÷ الكل)</label>
                                <label style={{ cursor: 'pointer' }}><input type="radio" checked={c.scoring_mode === 'all'} onChange={() => patch({ scoring_mode: 'all' })} /> الكل مطلوب</label>
                            </div>
                        )}
                        <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 8 }}>اترك البنود فارغة لاستخدام التقييم البسيط (مستوفٍ / جزئي / غير مستوفٍ).</p>
                    </div>
                );
            })()}
        </>
    );

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
                                        editingCriterion === c.id ? (
                                            <div key={c.id} style={{ padding: '12px', background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--primary-light)' }}>
                                                {criterionFields(editValues, patch => setEditValues(v => ({ ...v, ...patch })))}
                                                <p style={{ fontSize: 11, color: 'var(--warning)', margin: '8px 0 0' }}>ملاحظة: يؤثر التعديل على جميع الفترات التي تستخدم هذا المؤشر.</p>
                                                <div className="flex items-center gap-2" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                                                    <button className="btn btn-ghost btn-sm" onClick={cancelEditCriterion}>إلغاء</button>
                                                    <button className="btn btn-primary btn-sm" onClick={saveEditCriterion}>حفظ</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div key={c.id} className="flex items-center justify-between" style={{ padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
                                                <span style={{ fontSize: 13 }}>
                                                    {c.name_ar}
                                                    {c.config?.ai_guidance && <span title="لديه تعليمات تقييم آلي" style={{ marginRight: 6 }}>🤖</span>}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <span className="badge badge-gray">{TYPE_LABEL[c.criterion_type]}</span>
                                                    <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>وزن {Math.round(Number(c.weight) * 100)}%</span>
                                                    <button className="btn btn-ghost btn-sm" onClick={() => startEditCriterion(c)}>تعديل</button>
                                                </div>
                                            </div>
                                        )
                                    ))}
                                </div>
                                {addingCriterionTo === ind.id ? (
                                    <div style={{ padding: '12px', background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--gray-200)' }}>
                                        {criterionFields(newCriterion, patch => setNewCriterion(c => ({ ...c, ...patch })))}
                                        <div className="flex items-center gap-2" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                                            <button className="btn btn-ghost btn-sm" onClick={() => setAddingCriterionTo(null)}>إلغاء</button>
                                            <button className="btn btn-primary btn-sm" onClick={() => addCriterion(ind.id)}>حفظ</button>
                                        </div>
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
                            <div style={{ display: 'grid', gap: 10, marginBottom: 8 }}>
                                {form.criteria.map((c, i) => (
                                    <div key={i} style={{ padding: '12px', border: '1px solid var(--gray-200)', borderRadius: 8 }}>
                                        {criterionFields(c, patch => updateCriterionRow(i, patch), { onRemove: () => removeCriterionRow(i), removeDisabled: form.criteria.length === 1 })}
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
