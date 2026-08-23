import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { settingsAPI } from '../../utils/api';

export default function Settings() {
    const [value, setValue] = useState('');
    const [savedValue, setSavedValue] = useState(''); // last persisted (or default) text
    const [defaultValue, setDefaultValue] = useState('');
    const [variables, setVariables] = useState([]);
    const [isDefault, setIsDefault] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const taRef = useRef(null);

    useEffect(() => {
        settingsAPI.getAiEvalPrompt()
            .then(r => {
                setValue(r.data.value || ''); setSavedValue(r.data.value || '');
                setDefaultValue(r.data.default || ''); setVariables(r.data.variables || []);
                setIsDefault(!!r.data.is_default);
            })
            .catch(() => toast.error('تعذر تحميل الإعدادات'))
            .finally(() => setLoading(false));
    }, []);

    const insertVar = (name) => {
        const token = `{{${name}}}`;
        const ta = taRef.current;
        if (!ta) { setValue(v => v + token); return; }
        const start = ta.selectionStart ?? value.length;
        const end = ta.selectionEnd ?? value.length;
        setValue(value.slice(0, start) + token + value.slice(end));
        requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + token.length; });
    };

    const save = async () => {
        if (!value.trim()) { toast.error('النص مطلوب'); return; }
        setSaving(true);
        try {
            const r = await settingsAPI.saveAiEvalPrompt(value);
            setSavedValue(value); setIsDefault(!!r.data.is_default);
            toast.success('تم حفظ التوجيه');
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ في الحفظ'); }
        finally { setSaving(false); }
    };

    const reset = async () => {
        if (!window.confirm('إعادة التوجيه إلى الوضع الافتراضي؟ سيُحذف أي نص مخصّص محفوظ.')) return;
        setSaving(true);
        try {
            const r = await settingsAPI.resetAiEvalPrompt();
            setValue(r.data.value || ''); setSavedValue(r.data.value || ''); setIsDefault(true);
            toast.success('تمت الإعادة للوضع الافتراضي');
        } catch { toast.error('خطأ'); }
        finally { setSaving(false); }
    };

    if (loading) return <div className="flex items-center justify-center" style={{ height: 200 }}><div className="spinner" /></div>;

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>التوجيه العام الذي يتبعه المُقيِّم الآلي (الذكاء الاصطناعي) عند تقييم أدلة الأقسام</p>
                <span className={`badge ${isDefault ? 'badge-gray' : 'badge-primary'}`}>{isDefault ? 'الوضع الافتراضي' : 'مخصّص'}</span>
            </div>

            <div className="card" style={{ padding: 20 }}>
                <label className="form-label">توجيه التقييم الآلي</label>
                <textarea
                    ref={taRef} className="form-textarea"
                    style={{ width: '100%', minHeight: 280, fontSize: 13, lineHeight: 1.9 }}
                    value={value} onChange={e => setValue(e.target.value)}
                />

                <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 6 }}>المتغيّرات المتاحة — اضغط للإدراج:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {variables.map(v => (
                            <button
                                key={v.name} type="button" onClick={() => insertVar(v.name)}
                                style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--gray-200)', background: '#fff', cursor: 'pointer' }}
                            >
                                <span style={{ fontFamily: 'monospace', direction: 'ltr', unicodeBidi: 'embed' }}>{`{{${v.name}}}`}</span>
                                <span style={{ color: 'var(--gray-400)', marginRight: 6 }}>{v.label_ar}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 14, lineHeight: 1.7 }}>
                    يُطبَّق هذا التوجيه على جميع عمليات التقييم الآلي. أمّا تعليمات كل معيار على حدة فتُضبط من صفحة «المؤشرات والمعايير»،
                    وتعليمات تنسيق المخرجات (بحسب نوع كل معيار) تُدار تلقائياً ولا حاجة لذكرها هنا.
                </p>

                <div className="flex items-center gap-2" style={{ marginTop: 16, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" onClick={save} disabled={saving || !value.trim() || value === savedValue}>
                        {saving ? 'جاري الحفظ...' : 'حفظ'}
                    </button>
                    <button className="btn btn-secondary" onClick={reset} disabled={saving}>إعادة للوضع الافتراضي</button>
                    {value.trim() === defaultValue.trim() && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>مطابق للنص الافتراضي</span>}
                </div>
            </div>
        </div>
    );
}
