import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { notificationsAPI, systemAPI } from '../../utils/api';

const ROLE_LABELS = { admin: 'وحدة ضمان الجودة', qc_head: 'رئيس قسم الجودة', dept_rep: 'ممثل القسم', viewer: 'مشاهد' };
const NAV = [
    { to: '/', icon: '▣', label: 'لوحة التحكم', exact: true },
    { to: '/departments', icon: '⊞', label: 'الأقسام والكليات' },
    { to: '/submissions', icon: '⇪', label: 'رفع المستندات', roles: ['admin', 'qc_head', 'dept_rep'] },
    { to: '/evaluations', icon: '✔', label: 'المراجعة والتقييم', roles: ['admin', 'qc_head'] },
    { to: '/periods', icon: '⧗', label: 'الفترات التقييمية', roles: ['admin'] },
    { to: '/indicators', icon: '☰', label: 'المؤشرات والمعايير', roles: ['admin'] },
    { to: '/analytics', icon: '⊿', label: 'التحليلات والتقارير', roles: ['admin', 'qc_head'] },
    { to: '/notifications', icon: '⌚', label: 'الإشعارات', badge: true },
    { to: '/users', icon: '⊙', label: 'المستخدمون', roles: ['admin'] },
    { to: '/settings', icon: '⚙', label: 'إعدادات التقييم الآلي', roles: ['admin'] },
];
const PAGE_TITLES = {
    '/': 'لوحة التحكم',
    '/departments': 'الأقسام والكليات',
    '/submissions': 'رفع المستندات',
    '/evaluations': 'المراجعة والتقييم',
    '/periods': 'الفترات التقييمية',
    '/indicators': 'المؤشرات والمعايير',
    '/analytics': 'التحليلات والتقارير',
    '/notifications': 'الإشعارات',
    '/users': 'المستخدمون',
    '/settings': 'إعدادات التقييم الآلي',
};

export default function Layout() {
    const { user, logout, can } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [unread, setUnread] = useState(0);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [version, setVersion] = useState('');
    const pageTitle = PAGE_TITLES[location.pathname] || 'نظام متابعة الأداء';

    useEffect(() => {
        notificationsAPI.list().then(r => setUnread(r.data.unread_count)).catch(() => {});
        const iv = setInterval(() => notificationsAPI.list().then(r => setUnread(r.data.unread_count)).catch(() => {}), 60000);
        return () => clearInterval(iv);
    }, [location.pathname]);

    useEffect(() => {
        systemAPI.health().then(r => setVersion(r.data.version || '')).catch(() => {});
    }, []);

    const initials = (name) => name?.split(' ').slice(0, 2).map(w => w[0]).join('') || '?';

    return (
        <div className="layout">
            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <img src="/uowa-logo-b.svg" alt="شعار جامعة وارث الأنبياء" className="sidebar-logo-img" />
                        <div>
                            <div className="sidebar-logo-text">نظام متابعة الأداء</div>
                            <div className="sidebar-logo-sub">وحدة ضمان الجودة</div>
                        </div>
                    </div>
                </div>
                <nav className="sidebar-nav">
                    <div className="nav-section-label">القائمة الرئيسية</div>
                    {NAV.filter(n => !n.roles || n.roles.some(r => can(r))).map(n => (
                        <NavLink key={n.to} to={n.to} end={n.exact} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                            <span className="nav-icon">{n.icon}</span>
                            <span style={{ flex: 1 }}>{n.label}</span>
                            {n.badge && unread > 0 && <span className="nav-badge">{unread}</span>}
                        </NavLink>
                    ))}
                </nav>
                <div className="sidebar-footer">
                    <div className="sidebar-user">
                        <div className="avatar">{initials(user?.full_name_ar || user?.full_name)}</div>
                        <div className="sidebar-user-info">
                            <div className="sidebar-user-name truncate">{user?.full_name_ar || user?.full_name}</div>
                            <div className="sidebar-user-role">{ROLE_LABELS[user?.role]}</div>
                        </div>
                        <button type="button" className="sidebar-logout" onClick={() => { logout(); navigate('/login'); }}>خروج</button>
                    </div>
                    {version && <div className="sidebar-version">الإصدار {version}</div>}
                </div>
            </aside>
            <div className="main-content">
                <header className="top-header">
                    <h1 className="header-title">{pageTitle}</h1>
                    <div className="header-actions">
                        <button className="icon-btn" onClick={() => navigate('/notifications')} aria-label="notifications">
                            ⌚
                            {unread > 0 && <span className="badge-dot" />}
                        </button>
                        <div className="avatar avatar-sm">{initials(user?.full_name_ar || user?.full_name)}</div>
                    </div>
                </header>
                <main className="page-content"><Outlet /></main>
            </div>
            {sidebarOpen && <div style={{ position:'fixed',inset:0,zIndex:98,background:'rgba(0,0,0,.3)' }} onClick={() => setSidebarOpen(false)} />}
        </div>
    );
}
