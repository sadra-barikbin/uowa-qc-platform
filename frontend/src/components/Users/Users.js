import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { usersAPI } from '../../utils/api';

const ROLES = { admin: 'وحدة ضمان الجودة', qc_head: 'رئيس القسم', dept_rep: 'ممثل قسم', viewer: 'مشاهد' };
const ROLE_BADGE = { admin: 'badge-danger', qc_head: 'badge-primary', dept_rep: 'badge-warning', viewer: 'badge-gray' };

export default function Users() {
    const [users, setUsers] = useState([]);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editUser, setEditUser] = useState(null);
    const [form, setForm] = useState({ email: '', password: '', full_name: '', full_name_ar: '', role: 'viewer', is_active: true });
    const [saving, setSaving] = useState(false);

    const load = () => usersAPI.list().then(r => setUsers(r.data.users || [])).catch(() => {});
    useEffect(() => { load(); }, []);

    const filtered = users.filter(u => u.email.includes(search) || u.full_name?.includes(search) || u.full_name_ar?.includes(search));

    const openAdd = () => { setEditUser(null); setForm({ email: '', password: '', full_name: '', full_name_ar: '', role: 'viewer', is_active: true }); setShowModal(true); };
    const openEdit = u => { setEditUser(u); setForm({ email: u.email, password: '', full_name: u.full_name, full_name_ar: u.full_name_ar || '', role: u.role, is_active: u.is_active }); setShowModal(true); };

    const save = async () => {
        if (!form.email || (!editUser && !form.password)) { toast.error('البريد وكلمة المرور مطلوبان'); return; }
        setSaving(true);
        try {
            const data = { ...form };
            if (!data.password) delete data.password;
            if (editUser) await usersAPI.update(editUser.id, data);
            else await usersAPI.create(data);
            toast.success(editUser ? 'تم التحديث' : 'تمت الإضافة');
            await load();
            setShowModal(false);
        } catch (err) { toast.error(err.response?.data?.error || 'خطأ'); }
        finally { setSaving(false); }
    };

    const toggleActive = async (u) => {
        try {
            await usersAPI.update(u.id, { is_active: !u.is_active });
            await load();
            toast.success(u.is_active ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب');
        } catch { toast.error('خطأ'); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <input className="form-input" style={{ maxWidth: 300 }} placeholder="بحث عن مستخدم..." value={search} onChange={e => setSearch(e.target.value)} />
                <button className="btn btn-primary" onClick={openAdd}>+ إضافة مستخدم</button>
            </div>

            <div className="card">
                <div className="table-wrap">
                    <table>
                        <thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th>إجراءات</th></tr></thead>
                        <tbody>
                            {filtered.map(u => (
                                <tr key={u.id}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                                                {(u.full_name_ar || u.full_name || '?').charAt(0)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{u.full_name_ar || u.full_name}</div>
                                                {u.full_name_ar && u.full_name && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{u.full_name}</div>}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ fontSize: 13, direction: 'ltr' }}>{u.email}</td>
                                    <td><span className={`badge ${ROLE_BADGE[u.role]}`}>{ROLES[u.role]}</span></td>
                                    <td><span className={`badge ${u.is_active ? 'badge-success' : 'badge-gray'}`}>{u.is_active ? 'نشط' : 'موقوف'}</span></td>
                                    <td style={{ fontSize: 12, color: 'var(--gray-400)' }}>{u.last_login ? new Date(u.last_login).toLocaleDateString('ar-IQ') : 'لم يدخل'}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>تعديل</button>
                                            <button className="btn btn-ghost btn-sm" style={{ color: u.is_active ? 'var(--danger)' : 'var(--success)' }} onClick={() => toggleActive(u)}>
                                                {u.is_active ? 'إيقاف' : 'تفعيل'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filtered.length === 0 && <div className="empty-state"><p>لا يوجد مستخدمون</p></div>}
                </div>
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">{editUser ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</span>
                            <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-grid-2">
                                <div className="form-group">
                                    <label className="form-label">الاسم بالعربية</label>
                                    <input className="form-input" value={form.full_name_ar} onChange={e => setForm(f => ({ ...f, full_name_ar: e.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">الاسم بالإنجليزية</label>
                                    <input className="form-input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">البريد الإلكتروني *</label>
                                    <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ direction: 'ltr' }} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{editUser ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور *'}</label>
                                    <input className="form-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">الدور</label>
                                    <select className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                                        {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">الحالة</label>
                                    <select className="form-select" value={form.is_active ? '1' : '0'} onChange={e => setForm(f => ({ ...f, is_active: e.target.value === '1' }))}>
                                        <option value="1">نشط</option>
                                        <option value="0">موقوف</option>
                                    </select>
                                </div>
                            </div>
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
