// Sentry initialization — imported first in index.js so it initializes before
// the app renders. Configure via env vars in frontend/.env:
//
//   REACT_APP_SENTRY_DSN=<dsn from your Sentry frontend (React) project>
//
// Create a separate Sentry project for the frontend and paste its DSN above.
// If REACT_APP_SENTRY_DSN is unset, Sentry stays disabled (no-op) — safe for
// local dev and for builds where you don't want reporting.
import * as Sentry from '@sentry/react';

const dsn = process.env.REACT_APP_SENTRY_DSN;

if (dsn) {
    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV || 'development',
        // Release name — stamped at build time by scripts/release.js so events
        // line up with the uploaded source maps. Symbolication itself is matched
        // by debug IDs, so this is mainly for grouping/tracking.
        release: process.env.REACT_APP_SENTRY_RELEASE,
        integrations: [Sentry.browserTracingIntegration()],
        // Tracing — modest default; adjust to taste. (Session Replay is intentionally
        // not enabled: this app handles institutional evaluation data.)
        tracesSampleRate: 0.1,
        // Trace propagation to the backend API (so frontend<->backend traces link up).
        tracePropagationTargets: ['localhost', /^\/api\//],
    });
}
