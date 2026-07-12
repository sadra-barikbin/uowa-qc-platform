import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout/Layout';
import Login from './components/Auth/Login';
import Dashboard from './components/Dashboard/Dashboard';
import Departments from './components/Departments/Departments';
import DepartmentDetail from './components/Departments/DepartmentDetail';
import Submissions from './components/Submissions/Submissions';
import Evaluations from './components/Evaluations/Evaluations';
import Periods from './components/Periods/Periods';
import Indicators from './components/Indicators/Indicators';
import Analytics from './components/Analytics/Analytics';
import Users from './components/Users/Users';
import Notifications from './components/Notifications/Notifications';
import './styles/global.css';

function PrivateRoute({ children, roles }) {
    const { user, loading } = useAuth();
    if (loading) return <div className="page-loader"><div className="spinner"/></div>;
    if (!user) return <Navigate to="/login" replace />;
    if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
    return children;
}

function AppRoutes() {
    const { user } = useAuth();
    return (
        <Routes>
            <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
            <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="departments" element={<Departments />} />
                <Route path="departments/:id" element={<DepartmentDetail />} />
                <Route path="submissions" element={<PrivateRoute roles={['admin','qc_head','dept_rep']}><Submissions /></PrivateRoute>} />
                <Route path="evaluations" element={<PrivateRoute roles={['admin','qc_head']}><Evaluations /></PrivateRoute>} />
                <Route path="periods" element={<PrivateRoute roles={['admin']}><Periods /></PrivateRoute>} />
                <Route path="indicators" element={<PrivateRoute roles={['admin']}><Indicators /></PrivateRoute>} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="users" element={<PrivateRoute roles={['admin']}><Users /></PrivateRoute>} />
                <Route path="notifications" element={<Notifications />} />
            </Route>
            <Route path="*" element={<Navigate to="/" />} />
        </Routes>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <AppRoutes />
                <Toaster position="top-center" toastOptions={{ duration: 3500, style: { borderRadius: '10px', fontSize: '14px' } }} />
            </BrowserRouter>
        </AuthProvider>
    );
}
