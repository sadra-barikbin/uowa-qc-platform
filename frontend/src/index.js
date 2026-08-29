import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import App from './App';

// Error monitoring. The DSN is baked in at build time from REACT_APP_SENTRY_DSN (set by the desktop
// release build); when it's absent — normal dev / web builds — Sentry stays disabled.
if (process.env.REACT_APP_SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.REACT_APP_SENTRY_DSN,
        environment: process.env.NODE_ENV,
        tracesSampleRate: 0,
    });
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
