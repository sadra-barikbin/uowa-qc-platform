import 'dotenv/config';
import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import cron from 'node-cron';

import { sequelize } from './config/database';
import { ensureViews, dropViews } from './utils/ensureViews';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import departmentRoutes from './routes/departments';
import periodRoutes from './routes/periods';
import indicatorRoutes from './routes/indicators';
import submissionRoutes from './routes/submissions';
import evaluationRoutes from './routes/evaluations';
import reportRoutes from './routes/reports';
import notificationRoutes from './routes/notifications';
import dashboardRoutes from './routes/dashboard';
import settingsRoutes from './routes/settings';
import { sendDeadlineReminders } from './utils/notifications';

const app = express();
const PORT = process.env.PORT || 5000;

// ── Security middleware ───────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many login attempts' } });
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Static files (uploads) ────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/departments',   departmentRoutes);
app.use('/api/periods',       periodRoutes);
app.use('/api/indicators',    indicatorRoutes);
app.use('/api/submissions',   submissionRoutes);
app.use('/api/evaluations',   evaluationRoutes);
app.use('/api/reports',       reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/settings',      settingsRoutes);

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req: Request, res: Response) => res.json({ status: 'ok', timestamp: new Date() }));

// ── Global error handler ──────────────────────────────────────
app.use((err: Error & { status?: number }, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    const status = err.status || 500;
    res.status(status).json({
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

// ── Cron jobs ─────────────────────────────────────────────────
// Run every day at 8 AM to send deadline reminders
cron.schedule('0 8 * * *', () => {
    console.log('[CRON] Running deadline reminder check...');
    sendDeadlineReminders().catch(console.error);
});

// ── Start server ──────────────────────────────────────────────
async function start() {
    try {
        await sequelize.authenticate();
        console.log('✅  Database connected');
        await dropViews(sequelize);
        await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
        console.log('✅  Models synced');
        await ensureViews(sequelize);
        console.log('✅  Aggregation views ready');
        app.listen(PORT, () => console.log(`🚀  Server running on http://localhost:${PORT}`));
    } catch (err) {
        console.error('❌  Failed to start:', err);
        process.exit(1);
    }
}

start();
