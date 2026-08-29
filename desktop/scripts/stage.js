// Build the backend + frontend and stage them under desktop/resources/, ready for electron-builder
// to ship as unpacked extraResources. Runs cross-platform (Windows/macOS/Linux).
//
//   resources/backend/   dist + package.json + production node_modules  (the forked API server)
//   resources/frontend/  the built React app                            (served by that server)
//
// No native modules are involved (PGlite is WASM), so there is nothing to rebuild for Electron.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopDir = path.join(__dirname, '..');
const rootDir = path.join(desktopDir, '..');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');
const resourcesDir = path.join(desktopDir, 'resources');
const stagedBackend = path.join(resourcesDir, 'backend');
const stagedFrontend = path.join(resourcesDir, 'frontend');

// Two Sentry projects — one for the backend/shell (Node) and one for the frontend (React) — so each
// DSN goes to its own project. Baked in from the environment at build/release time, never committed;
// both are safe to embed (a DSN only permits sending events). Provide them via
// `SENTRY_DSN_BACKEND=… SENTRY_DSN_FRONTEND=… npm run release`.
const backendSentryDsn = process.env.SENTRY_DSN_BACKEND || '';
const frontendSentryDsn = process.env.SENTRY_DSN_FRONTEND || '';

// The Sentry release name = the packaged app version, so it lines up with what the running app
// reports (the shell tags the backend child and its own events with app.getVersion()). Source maps
// are uploaded under this same release. Overridable via SENTRY_RELEASE.
const release = process.env.SENTRY_RELEASE || require('../package.json').version;

// Upload source maps only when an auth token is available (release builds / CI). Without it — local
// `npm run pack`/`build` — we skip the upload and ship no maps, exactly as before.
const willUpload = !!process.env.SENTRY_AUTH_TOKEN;

const run = (cmd, cwd, extraEnv = {}) => {
    console.log(`\n$ ${cmd}   (in ${path.relative(rootDir, cwd) || '.'})`);
    execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1', ...extraEnv } });
};

// Recursively delete every *.map under `dir` — used to keep source maps out of the shipped bundle
// after they've been uploaded to Sentry (debug IDs stay embedded in the JS, so symbolication works).
const stripSourceMaps = (dir) => {
    let removed = 0;
    const walk = (d) => {
        for (const name of fs.readdirSync(d)) {
            const p = path.join(d, name);
            if (fs.statSync(p).isDirectory()) walk(p);
            else if (p.endsWith('.map')) { fs.rmSync(p); removed++; }
        }
    };
    if (fs.existsSync(dir)) walk(dir);
    return removed;
};

// 0. Bake the backend/shell DSN for the Electron shell + backend child to read at runtime (packed
//    into the app by electron-builder `files`). Empty when not provided — Sentry then stays disabled.
fs.writeFileSync(path.join(desktopDir, 'sentry.json'), JSON.stringify({ dsn: backendSentryDsn }, null, 2));
console.log(`\nSentry backend/shell DSN ${backendSentryDsn ? 'baked in' : 'not set'}; ` +
    `frontend DSN ${frontendSentryDsn ? 'baked in' : 'not set'}; ` +
    `source-map upload ${willUpload ? `on (release ${release})` : 'off (no SENTRY_AUTH_TOKEN)'}`);

// 1. Compile the backend (TypeScript -> dist/, with source maps) and build the frontend. The frontend
//    build only emits maps when we intend to upload them; REACT_APP_SENTRY_DSN and the release are
//    compiled into the bundle so it reports to its own project under the same release.
run('npm run build', backendDir);
run('npm run build', frontendDir, {
    GENERATE_SOURCEMAP: willUpload ? 'true' : 'false',
    REACT_APP_SENTRY_DSN: frontendSentryDsn,
    REACT_APP_SENTRY_RELEASE: release,
});

// 2. Inject debug IDs + upload source maps to Sentry (each app to its own project) under `release`.
//    SENTRY_AUTH_TOKEN is inherited from the environment; org/project/URL default inside the scripts.
if (willUpload) {
    run('npm run sentry:sourcemaps', backendDir, { SENTRY_RELEASE: release });
    run('npm run sentry:sourcemaps', frontendDir, { SENTRY_RELEASE: release });
}

// 3. Fresh staging dir.
fs.rmSync(resourcesDir, { recursive: true, force: true });
fs.mkdirSync(stagedBackend, { recursive: true });

// 4. Stage the backend: compiled code (now carrying debug IDs) + manifests, then prod-only deps.
fs.cpSync(path.join(backendDir, 'dist'), path.join(stagedBackend, 'dist'), { recursive: true });
for (const f of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(backendDir, f), path.join(stagedBackend, f));
}
console.log('\nInstalling backend production dependencies into resources/backend …');
run('npm ci --omit=dev --ignore-scripts', stagedBackend);

// 5. Stage the frontend build.
fs.cpSync(path.join(frontendDir, 'build'), stagedFrontend, { recursive: true });

// 6. Keep the uploaded maps out of the shipped bundle (debug IDs remain in the JS).
if (willUpload) {
    const n = stripSourceMaps(stagedBackend) + stripSourceMaps(stagedFrontend);
    console.log(`\nStripped ${n} source-map file(s) from the staged bundle.`);
}

console.log('\n✅  Staged backend + frontend into desktop/resources/');
