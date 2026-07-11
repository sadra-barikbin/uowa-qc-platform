# نظام متابعة الأداء الأكاديمي الجامعي
# University Academic Performance Tracking System

## نظرة عامة | Overview

منصة ويب متكاملة لمتابعة الأداء الأكاديمي لجميع الأقسام والكليات الجامعية، مع لوحة تحكم تفاعلية ونظام إدخال بيانات وتقارير احترافية.

---

## المتطلبات | Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- npm >= 9
- (اختياري) Docker & Docker Compose

---

## الإعداد السريع | Quick Setup

### الطريقة 1: Docker (موصى به)

```bash
# 1. استنساخ المشروع
git clone <repo-url>
cd university-platform

# 2. إنشاء ملف البيئة
cp backend/.env.example backend/.env
# عدّل القيم في backend/.env

# 3. تشغيل جميع الخدمات
docker-compose up -d

# 4. بذر البيانات التجريبية
docker exec univ_backend node utils/seedData.js

# 5. افتح المتصفح
# Frontend: http://localhost:3000
# Backend API: http://localhost:5000/api
```

---

### الطريقة 2: التشغيل المحلي

#### قاعدة البيانات (PostgreSQL)

```bash
# إنشاء قاعدة البيانات
psql -U postgres
CREATE DATABASE university_platform;
\q

# تطبيق الـ schema
psql -U postgres -d university_platform -f database/schema.sql
```

#### الـ Backend

```bash
cd backend

# نسخ وتعديل ملف البيئة
cp .env.example .env
# افتح .env وعدّل DB_PASSWORD و JWT_SECRET

# تثبيت الحزم
npm install

# بذر البيانات التجريبية (المرة الأولى فقط)
npm run seed

# تشغيل الخادم
npm run dev
# سيعمل على: http://localhost:5000
```

#### الـ Frontend

```bash
cd frontend

# تثبيت الحزم
npm install

# تشغيل
npm start
# سيعمل على: http://localhost:3000
```

---

## حسابات الدخول التجريبية | Demo Credentials

| الدور | البريد | كلمة المرور |
|-------|--------|-------------|
| وحدة ضمان الجودة (admin) | admin@uowa.edu.iq | Admin@123 |
| رئيس قسم ضمان الجودة (qc_head) | qc.head@uowa.edu.iq | Head@123 |
| ممثل قسم أكاديمي (dept_rep) | rep.islamic@uowa.edu.iq | Rep@123 |
| ممثل قسم أكاديمي (dept_rep) | rep.eng@uowa.edu.iq | Rep@123 |
| مشاهد (viewer) | viewer@uowa.edu.iq | View@123 |

---

## بنية المشروع | Project Structure

```
university-platform/
├── backend/
│   ├── config/
│   │   └── database.js          # Sequelize connection
│   ├── middleware/
│   │   └── auth.js              # JWT auth + RBAC
│   ├── models/
│   │   └── index.js             # All Sequelize models + associations
│   ├── routes/
│   │   ├── auth.js              # Login, /me, change-password
│   │   ├── users.js             # CRUD users (admin only)
│   │   ├── departments.js       # CRUD departments/colleges, rep assignment
│   │   ├── periods.js           # Evaluation periods (open/close, clone indicators)
│   │   ├── indicators.js        # CRUD indicators + their criteria
│   │   ├── submissions.js       # Dept rep evidence upload per criterion
│   │   ├── evaluations.js       # Reviewer/AI scoring per criterion, score rollups
│   │   ├── dashboard.js         # KPIs, trends, indicator scores
│   │   ├── reports.js           # Excel/PDF export (per-indicator + aggregation sheets), comparison
│   │   └── notifications.js     # List, mark read, create
│   ├── utils/
│   │   ├── seedData.js          # Seed 35+ departments + sample data
│   │   └── notifications.js     # Cron job helpers
│   ├── uploads/                 # Uploaded files (Excel, etc.)
│   ├── server.js                # Express app entry point
│   ├── package.json
│   ├── .env.example
│   └── Dockerfile
│
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── Auth/Login.js         # Login page with demo buttons
│       │   ├── Layout/Layout.js      # Sidebar + top header
│       │   ├── Dashboard/Dashboard.js # KPIs + Bar/Donut/Line charts
│       │   ├── Departments/
│       │   │   ├── Departments.js    # Dept cards grouped by college
│       │   │   └── DepartmentDetail.js # Per-dept data view
│       │   ├── DataEntry/DataEntry.js # Metric entry form + Excel upload
│       │   ├── Analytics/Analytics.js # Radar + comparison + export
│       │   ├── Users/Users.js        # User management (admin)
│       │   └── Notifications/...     # Notification feed
│       ├── contexts/AuthContext.js   # JWT auth state
│       ├── utils/api.js              # Axios client + all API calls
│       ├── styles/global.css         # RTL CSS design system
│       └── App.js                    # Router + PrivateRoute
│
├── database/
│   └── schema.sql               # PostgreSQL schema + seed categories
├── docker-compose.yml
└── README.md
```

---

## API Reference | مرجع الـ API

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | تسجيل الدخول |
| GET | `/api/auth/me` | بيانات المستخدم الحالي |
| POST | `/api/auth/change-password` | تغيير كلمة المرور |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/summary?period_id=` | ملخص KPIs + جميع الأقسام |
| GET | `/api/dashboard/trends` | اتجاه الأداء (آخر 6 فترات) |
| GET | `/api/dashboard/indicator-scores?period_id=` | متوسط كل مؤشر |
| GET | `/api/dashboard/pending-reviews?period_id=` | عدد المستندات بانتظار التقييم |

### Evaluation Periods
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/periods` | كل الفترات |
| POST | `/api/periods` | إنشاء فترة جديدة (مع نسخ مؤشرات فترة سابقة اختياريًا) |
| PUT | `/api/periods/:id` | تعديل حالة/موعد الفترة |
| PUT | `/api/periods/:id/indicators` | تحديد المؤشرات وأوزانها لهذه الفترة |

### Indicators
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/indicators` | كل المؤشرات ومعاييرها |
| POST | `/api/indicators` | إنشاء مؤشر جديد (مع معاييره) |
| POST | `/api/indicators/:id/criteria` | إضافة معيار لمؤشر |

### Submissions (ممثل القسم)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/submissions/matrix?period_id=&department_id=` | شبكة المعايير + المستندات المرفوعة |
| POST | `/api/submissions` | إنشاء/تحديث رفع لمعيار معين |
| POST | `/api/submissions/:id/documents` | رفع ملفات إثبات |
| GET | `/api/submissions/documents/:docId/download` | تنزيل مستند |

### Evaluations (لجنة الجودة)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/evaluations/matrix?period_id=&department_id=` | شبكة التقييم (مستندات + درجات) |
| POST | `/api/evaluations` | تسجيل/تحديث درجة معيار |
| GET | `/api/evaluations/scores/departments?period_id=` | الدرجة النهائية لكل قسم |
| GET | `/api/evaluations/scores/colleges?period_id=` | الدرجة النهائية لكل كلية |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports/export/excel?period_id=` | تصدير Excel (ورقة لكل مؤشر + تقييم شامل + تقييم الكلية) |
| GET | `/api/reports/export/pdf?period_id=` | تصدير PDF |
| GET | `/api/reports/comparison?period1_id=&period2_id=` | مقارنة فترتين |

---

## الصلاحيات | Permissions

| الإجراء | admin | qc_head | dept_rep | viewer |
|---------|-------|---------|----------|--------|
| عرض لوحة التحكم | ✅ | ✅ | ✅ | ✅ |
| رفع مستندات الإثبات | ✅ | ✅ | ✅ (لقسمه فقط) | ❌ |
| تقييم المعايير | ✅ | ✅ | ❌ | ❌ |
| إدارة المؤشرات والفترات | ✅ | ❌ | ❌ | ❌ |
| إدارة الأقسام | ✅ | ❌ | ❌ | ❌ |
| إدارة المستخدمين | ✅ | ❌ | ❌ | ❌ |
| تصدير التقارير | ✅ | ✅ | ✅ | ✅ |
| إرسال إشعارات | ✅ | ❌ | ❌ | ❌ |

---

## النشر على الإنتاج | Production Deployment

### متغيرات البيئة المطلوبة
```env
NODE_ENV=production
JWT_SECRET=<سلسلة عشوائية طويلة جداً>
DB_PASSWORD=<كلمة مرور قوية>
FRONTEND_URL=https://yourdomain.com
```

### نشر على Ubuntu Server
```bash
# 1. تثبيت Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. رفع الملفات
scp -r university-platform user@server:/app/

# 3. تشغيل
cd /app/university-platform
docker-compose -f docker-compose.yml up -d

# 4. SSL مع Certbot (اختياري)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## التقنيات المستخدمة | Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + React Router 6 |
| Charts | Chart.js + react-chartjs-2 |
| Backend | Node.js + Express 4 |
| ORM | Sequelize 6 |
| Database | PostgreSQL 15 |
| Auth | JWT (jsonwebtoken) |
| File Upload | Multer |
| Excel | xlsx (SheetJS) |
| PDF | PDFKit |
| Cron Jobs | node-cron |
| Container | Docker + Docker Compose |
| Web Server | Nginx (production) |

---

## إضافة فترة تقييم جديدة | Add New Evaluation Period

```bash
# عبر API (admin token مطلوب) — ينسخ مؤشرات وأوزان فترة سابقة إن رغبت
curl -X POST http://localhost:5000/api/periods \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"year":2026,"month":4,"label_ar":"أبريل 2026","label_en":"April 2026","submission_deadline":"2026-05-15","clone_from_period_id":"<previous-period-id>"}'
```
