import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';

export default function Login() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);

    const handle = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await login(form.email, form.password);
            toast.success('مرحباً بك!');
            navigate('/');
        } catch (err) {
            toast.error(err.response?.data?.error || 'خطأ في البريد أو كلمة المرور');
        } finally { setLoading(false); }
    };

    const fill = (email, password) => setForm({ email, password });

    return (
        <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#1a56db', padding:20 }}>
            <div style={{ background:'#fff', borderRadius:16, padding:'40px 36px', width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,.2)' }}>
                <div style={{ textAlign:'center', marginBottom:32 }}>
                    <img src="/uowa-logo-b.svg" alt="شعار جامعة وارث الأنبياء" style={{ height:80, margin:'0 auto 16px', display:'block' }} />
                    <h1 style={{ fontSize:20, fontWeight:700, color:'#111827', marginBottom:4 }}>نظام متابعة الأداء الأكاديمي</h1>
                    <p style={{ fontSize:13, color:'#6b7280' }}>تسجيل الدخول إلى حسابك</p>
                </div>
                <form onSubmit={handle}>
                    <div className="form-group">
                        <label className="form-label">البريد الإلكتروني</label>
                        <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="example@university.edu" required />
                    </div>
                    <div className="form-group">
                        <label className="form-label">كلمة المرور</label>
                        <input className="form-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" required />
                    </div>
                    <button className="btn btn-primary" type="submit" disabled={loading} style={{ width:'100%', justifyContent:'center', padding:'11px', fontSize:15 }}>
                        {loading ? 'جاري الدخول...' : 'تسجيل الدخول'}
                    </button>
                </form>
                <div style={{ marginTop:24, padding:'16px', background:'#f9fafb', borderRadius:10, border:'1px solid #e5e7eb' }}>
                    <p style={{ fontSize:11, fontWeight:600, color:'#6b7280', marginBottom:10, textAlign:'center' }}>حسابات تجريبية — اضغط للملء</p>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                        {[
                            { label:'وحدة الجودة', email:'admin@uowa.edu.iq', pass:'Admin@123', color:'#1a56db' },
                            { label:'رئيس القسم', email:'qc.head@uowa.edu.iq', pass:'Head@123', color:'#0e9f6e' },
                            { label:'ممثل قسم', email:'rep.islamic@uowa.edu.iq', pass:'Rep@123', color:'#c27803' },
                            { label:'مشاهد', email:'viewer@uowa.edu.iq', pass:'View@123', color:'#6b7280' },
                        ].map(acc => (
                            <button key={acc.email} onClick={() => fill(acc.email, acc.pass)} style={{ padding:'7px 10px', borderRadius:8, border:`1px solid ${acc.color}30`, background:`${acc.color}10`, color:acc.color, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                                {acc.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
