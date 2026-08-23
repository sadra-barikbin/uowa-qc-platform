import axios from 'axios';

const api = axios.create({
    baseURL: process.env.REACT_APP_API_URL || '/api',
    headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(cfg => {
    const token = localStorage.getItem('token');
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    return cfg;
});

api.interceptors.response.use(
    res => res,
    err => {
        if (err.response?.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }
        return Promise.reject(err);
    }
);

export const authAPI = {
    login: (data) => api.post('/auth/login', data),
    me: () => api.get('/auth/me'),
    changePassword: (data) => api.post('/auth/change-password', data),
};

export const usersAPI = {
    list: () => api.get('/users'),
    create: (data) => api.post('/users', data),
    update: (id, data) => api.put(`/users/${id}`, data),
    delete: (id) => api.delete(`/users/${id}`),
};

export const departmentsAPI = {
    list: () => api.get('/departments'),
    get: (id) => api.get(`/departments/${id}`),
    create: (data) => api.post('/departments', data),
    update: (id, data) => api.put(`/departments/${id}`, data),
    delete: (id) => api.delete(`/departments/${id}`),
    colleges: () => api.get('/departments/colleges/list'),
    addRepresentative: (deptId, data) => api.post(`/departments/${deptId}/representatives`, data),
    removeRepresentative: (deptId, userId) => api.delete(`/departments/${deptId}/representatives/${userId}`),
};

export const periodsAPI = {
    list: () => api.get('/periods'),
    get: (id) => api.get(`/periods/${id}`),
    create: (data) => api.post('/periods', data),
    update: (id, data) => api.put(`/periods/${id}`, data),
    setIndicators: (id, indicators) => api.put(`/periods/${id}/indicators`, { indicators }),
};

export const indicatorsAPI = {
    list: () => api.get('/indicators'),
    get: (id) => api.get(`/indicators/${id}`),
    create: (data) => api.post('/indicators', data),
    update: (id, data) => api.put(`/indicators/${id}`, data),
    delete: (id) => api.delete(`/indicators/${id}`),
    addCriterion: (indicatorId, data) => api.post(`/indicators/${indicatorId}/criteria`, data),
    updateCriterion: (criterionId, data) => api.put(`/indicators/criteria/${criterionId}`, data),
};

export const submissionsAPI = {
    matrix: (params) => api.get('/submissions/matrix', { params }),
    save: (data) => api.post('/submissions', data),
    uploadDocuments: (submissionId, formData) => api.post(`/submissions/${submissionId}/documents`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
    downloadDocument: (docId) => api.get(`/submissions/documents/${docId}/download`, { responseType: 'blob' }),
    deleteDocument: (docId) => api.delete(`/submissions/documents/${docId}`),
};

export const evaluationsAPI = {
    matrix: (params) => api.get('/evaluations/matrix', { params }),
    save: (data) => api.post('/evaluations', data),
    ai: (data) => api.post('/evaluations/ai', data),
    scoresIndicators: (params) => api.get('/evaluations/scores/indicators', { params }),
    scoresDepartments: (params) => api.get('/evaluations/scores/departments', { params }),
    scoresColleges: (params) => api.get('/evaluations/scores/colleges', { params }),
};

export const dashboardAPI = {
    summary: (params) => api.get('/dashboard/summary', { params }),
    trends: () => api.get('/dashboard/trends'),
    indicatorScores: (params) => api.get('/dashboard/indicator-scores', { params }),
    pendingReviews: (params) => api.get('/dashboard/pending-reviews', { params }),
};

export const reportsAPI = {
    exportExcel: (params) => api.get('/reports/export/excel', { params, responseType: 'blob' }),
    exportPDF: (params) => api.get('/reports/export/pdf', { params, responseType: 'blob' }),
    comparison: (params) => api.get('/reports/comparison', { params }),
};

export const notificationsAPI = {
    list: () => api.get('/notifications'),
    read: (id) => api.put(`/notifications/${id}/read`),
    readAll: () => api.put('/notifications/read-all'),
    create: (data) => api.post('/notifications', data),
};

export const settingsAPI = {
    getAiEvalPrompt: () => api.get('/settings/ai-eval-prompt'),
    saveAiEvalPrompt: (value) => api.put('/settings/ai-eval-prompt', { value }),
    resetAiEvalPrompt: () => api.delete('/settings/ai-eval-prompt'),
};

export default api;
