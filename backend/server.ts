// IMPORTANT: `./instrument` must be the first import so Sentry initializes
// before Express (and everything else) loads and can auto-instrument it. It reads
// SENTRY_DSN from the environment (injected by the desktop shell); unset = disabled.
import './instrument';
import 'dotenv/config';
import * as Sentry from '@sentry/node';
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
import { startPglite } from './utils/pglite';
import { runMigrations } from './utils/migrator';
import { ensureSeeded } from './utils/bootstrap';
import { User } from './models';
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

// In the packaged desktop app the frontend is served from this same Express process (see below),
// so it's all one local origin. PGLITE_DIR is the signal that we're running as the desktop app.
const isDesktop = !!process.env.PGLITE_DIR;

// ── Security middleware ───────────────────────────────────────
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // The bundled SPA (served same-origin) would otherwise trip helmet's default CSP on its
    // inline styles/fonts. It's a local single-user app, so CSP adds no meaningful protection here.
    contentSecurityPolicy: isDesktop ? false : undefined,
}));
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

// ── Sentry test route (dev only) ──────────────────────────────
// Hit GET /api/debug-sentry to confirm errors reach Sentry, then remove.
if (process.env.NODE_ENV !== 'production') {
    app.get('/api/debug-sentry', () => {
        throw new Error('My first Sentry error!');
    });
}

// ── Serve the built frontend (desktop app) ────────────────────
// When FRONTEND_DIR is set, this process also serves the React build, so the whole app is one
// local origin and the frontend's relative `/api` calls just work. Registered after all /api and
// /uploads routes so those win; the SPA fallback returns index.html for client-side routing.
if (process.env.FRONTEND_DIR) {
    const frontendDir = process.env.FRONTEND_DIR;
    app.use(express.static(frontendDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
        res.sendFile(path.join(frontendDir, 'index.html'));
    });
}

// ── Sentry error handler ──────────────────────────────────────
// Registered after all controllers and before our own error middleware. Reports
// genuine server faults (5xx by default) to Sentry with request context; expected
// 4xx validation/auth errors are skipped.
Sentry.setupExpressErrorHandler(app);

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
        // Desktop: bring up the embedded Postgres (PGlite) before anything connects to it.
        if (isDesktop) await startPglite();

        await sequelize.authenticate();
        console.log('✅  Database connected');
        await dropViews(sequelize);

        if (isDesktop) {
            // Packaged app: models own the baseline (sync, create-only — never alter a user's DB),
            // Umzug migrations carry existing installs forward, then views + first-run clean seed.
            await sequelize.sync();
            const fresh = (await User.count()) === 0;
            await runMigrations(sequelize, { fresh });
            await ensureViews(sequelize);
            await ensureSeeded(sequelize);
        } else {
            // Dev/self-hosted against a real Postgres: unchanged behaviour.
            await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
            await ensureViews(sequelize);
        }
        console.log('✅  Models synced, aggregation views ready');

        app.listen(PORT, () => console.log(`🚀  Server running on http://localhost:${PORT}`));
    } catch (err) {
        console.error('❌  Failed to start:', err);
        process.exit(1);
    }
}

start();
