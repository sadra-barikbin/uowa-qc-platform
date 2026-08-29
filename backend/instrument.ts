// Sentry initialization — MUST be imported before any other module (see server.ts).
// Loading env here as well so the DSN/environment are available regardless of
// import order relative to server.ts's own `dotenv/config`.
import 'dotenv/config';
import * as Sentry from '@sentry/node';

// DSN comes from the environment (SENTRY_DSN). If unset, Sentry initializes
// disabled (no events sent) — safe for local dev and for envs without reporting.
const dsn = process.env.SENTRY_DSN;

Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Release name — must match the one used when uploading source maps
    // (scripts/sentry-sourcemaps.js). Optional: symbolication is matched by the
    // debug IDs baked into the built files, so this is only for grouping/tracking.
    release: process.env.SENTRY_RELEASE,
    // Tracing — sample a fraction of transactions for performance monitoring.
    // Modest default; override (including 0 to disable) via SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
        ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
        : 0.1,
});
