import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { notificationsAPI } from '../../utils/api';

const TYPE_ICON = { missing_submission: '⚠', deadline: '⏰', review_needed: '✔', system: 'ℹ', reminder: '🔔' };
const TYPE_BADGE = { missing_submission: 'badge-danger', deadline: 'badge-warning', review_needed: 'badge-success', system: 'badge-gray', reminder: 'badge-primary' };
const TYPE_LABEL = { missing_submission: 'مستندات ناقصة', deadline: 'موعد نهائي', review_needed: 'بانتظار المراجعة', system: 'نظام', reminder: 'تذكير' };
const PRIORITY_COLOR = { urgent: '#e02424', high: '#c27803', normal: 'var(--gray-500)', low: 'var(--gray-400)' };

export default function Notifications() {
    const [notifs, setNotifs] = useState([]);
    const [unread, setUnread] = useState(0);
    const [filter, setFilter] = useState('all');

    const load = () => notificationsAPI.list().then(r => { setNotifs(r.data.notifications || []); setUnread(r.data.unread_count || 0); }).catch(() => {});
    useEffect(() => { load(); }, []);

    const markRead = async (id) => {
        await notificationsAPI.read(id).catch(() => {});
        setNotifs(ns => ns.map(n => n.id === id ? { ...n, is_read: true } : n));
        setUnread(u => Math.max(0, u - 1));
    };

    const markAll = async () => {
        await notificationsAPI.readAll().catch(() => {});
        setNotifs(ns => ns.map(n => ({ ...n, is_read: true })));
        setUnread(0);
        toast.success('تم تعليم الكل كمقروء');
    };

    const filtered = filter === 'unread' ? notifs.filter(n => !n.is_read) : filter === 'all' ? notifs : notifs.filter(n => n.type === filter);

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    {[['all', 'الكل'], ['unread', 'غير مقروءة'], ['missing_submission', 'مستندات ناقصة'], ['deadline', 'مواعيد']].map(([v, l]) => (
                        <button key={v} className={`btn btn-sm ${filter === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(v)}>{l}</button>
                    ))}
                </div>
                {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={markAll}>تعليم الكل كمقروء</button>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filtered.map(n => (
                    <div key={n.id} className="card" style={{ padding: '14px 18px', opacity: n.is_read ? 0.75 : 1, borderRight: n.is_read ? '' : `3px solid ${PRIORITY_COLOR[n.priority] || 'var(--primary)'}`, cursor: 'pointer' }} onClick={() => !n.is_read && markRead(n.id)}>
                        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                            <div className="flex items-center gap-2">
                                <span style={{ fontSize: 18 }}>{TYPE_ICON[n.type] || 'ℹ'}</span>
                                <span style={{ fontWeight: n.is_read ? 400 : 600, fontSize: 14 }}>{n.title_ar || n.title_en}</span>
                                <span className={`badge ${TYPE_BADGE[n.type]}`}>{TYPE_LABEL[n.type]}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />}
                                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{new Date(n.createdAt || n.created_at).toLocaleString('ar-IQ')}</span>
                            </div>
                        </div>
                        {n.message_ar && <p style={{ fontSize: 13, color: 'var(--gray-600)', marginRight: 28 }}>{n.message_ar}</p>}
                    </div>
                ))}
                {filtered.length === 0 && <div className="empty-state"><div className="empty-state-icon">⌚</div><h3>لا توجد إشعارات</h3><p>ستظهر هنا الإشعارات الجديدة</p></div>}
            </div>
        </div>
    );
}
