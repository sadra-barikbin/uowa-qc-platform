const { app, BrowserWindow, dialog, utilityProcess, ipcMain, Menu, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const Sentry = require('@sentry/electron/main');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

// `electron . --dev-live` runs a hot-reloading dev loop instead of the staged production bundle:
// the backend runs through ts-node-dev (no `tsc`) and the frontend through the CRA dev server
// (HMR, no `react-scripts build`), so neither needs a rebuild between edits. The real desktop
// behaviours (embedded PGlite DB, the File→API-key menu) are preserved. Only meaningful unpackaged.
const DEV_LIVE = !app.isPackaged && process.argv.includes('--dev-live');
const DEV_BACKEND_PORT = 5000;   // fixed ports in dev-live so they're predictable and match .env
const DEV_FRONTEND_PORT = 3001;
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let frontendChild = null;

// Error monitoring. A Sentry DSN is safe to embed (it only permits SENDING events, grants no access
// or spend), unlike the user's Anthropic key — so it ships in the app. This is the BACKEND project's
// DSN (the shell is a Node process, so it reports there alongside the backend); the frontend has its
// own project baked into the React bundle. It's read from sentry.json (baked in at build time by
// scripts/stage.js from SENTRY_DSN_BACKEND) or from SENTRY_DSN_BACKEND directly in `electron .` dev.
// Disabled when neither is set. This DSN is also handed to the backend child (as SENTRY_DSN).
function resolveSentryDsn() {
    if (process.env.SENTRY_DSN_BACKEND) return process.env.SENTRY_DSN_BACKEND;
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'sentry.json'), 'utf8')).dsn || ''; }
    catch { return ''; }
}
const SENTRY_DSN = resolveSentryDsn();
if (SENTRY_DSN) Sentry.init({ dsn: SENTRY_DSN, environment: app.isPackaged ? 'production' : 'development', release: app.getVersion() });

// ─────────────────────────────────────────────────────────────────────────────
// The desktop app is a thin shell around the existing backend: it runs the
// compiled Express server (with an embedded PGlite database) as a child process,
// then loads that server's URL in a window. All data lives under userData, which
// survives app updates. See resources/backend + resources/frontend (staged by
// scripts/stage.js) for what actually ships.
// ─────────────────────────────────────────────────────────────────────────────

let backendChild = null;
let mainWindow = null;

const userData = app.getPath('userData');
const pgDir = path.join(userData, 'pgdata');
const uploadsDir = path.join(userData, 'uploads');
const configPath = path.join(userData, 'config.json');
const logPath = path.join(userData, 'startup.log');
const apiKeyFile = path.join(userData, 'anthropic.key.enc');

let settingsWindow = null;

// Persistent diagnostic log (userData/startup.log). Survives so a stuck launch can be diagnosed:
// it captures shell milestones plus everything the backend child prints.
function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    try { fs.mkdirSync(userData, { recursive: true }); fs.appendFileSync(logPath, line + '\n'); } catch { /* ignore */ }
    console.log(line);
}

// Where the staged backend/frontend live: inside the app's resources when packaged,
// or the repo folders when running `electron .` in development.
const backendDir = app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend');
const frontendDir = app.isPackaged
    ? path.join(process.resourcesPath, 'frontend')
    : path.join(__dirname, '..', 'frontend', 'build');
const frontendSrcDir = path.join(__dirname, '..', 'frontend'); // dev-live: run the CRA dev server here
const serverEntry = path.join(backendDir, 'dist', 'server.js');

// A stable per-install secret for signing JWTs, generated once and persisted.
function loadConfig() {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* first run */ }
    if (!cfg.jwtSecret) {
        cfg.jwtSecret = crypto.randomBytes(48).toString('hex');
        fs.mkdirSync(userData, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    }
    return cfg;
}

// ── Anthropic API key (for optional AI grading) ───────────────────────────────
// The key is NEVER shipped with the app. The user pastes their own in Settings; we encrypt it at
// rest with Electron safeStorage (Windows DPAPI, tied to this Windows user account) and inject it
// into the backend's ANTHROPIC_API_KEY env at launch. aiEvaluator.ts reads that var lazily.
function hasApiKey() {
    return fs.existsSync(apiKeyFile);
}
function loadApiKey() {
    try {
        if (!fs.existsSync(apiKeyFile) || !safeStorage.isEncryptionAvailable()) return null;
        return safeStorage.decryptString(fs.readFileSync(apiKeyFile)) || null;
    } catch (e) {
        log(`could not decrypt API key: ${e && e.message || e}`);
        return null;
    }
}
function saveApiKey(key) {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this system, so the key cannot be stored safely.');
    }
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(apiKeyFile, safeStorage.encryptString(key));
}
function clearApiKey() {
    try { fs.rmSync(apiKeyFile, { force: true }); } catch { /* ignore */ }
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

function waitForHealth(port, timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tryOnce = () => {
            const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
                res.resume();
                if (res.statusCode === 200) return resolve();
                retry();
            });
            req.on('error', retry);
            req.on('timeout', () => { req.destroy(); retry(); });
        };
        const retry = () => {
            if (Date.now() > deadline) return reject(new Error('backend did not become healthy in time'));
            setTimeout(tryOnce, 500);
        };
        tryOnce();
    });
}

// Resolve once the dev server at `port` answers on `/` at all (any status) — the CRA dev server's
// first compile takes a while, so we poll like waitForHealth rather than assume it's instant.
function waitForHttp(port, timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tryOnce = () => {
            const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
                res.resume();
                resolve();
            });
            req.on('error', retry);
            req.on('timeout', () => { req.destroy(); retry(); });
        };
        const retry = () => {
            if (Date.now() > deadline) return reject(new Error('frontend dev server did not start in time'));
            setTimeout(tryOnce, 500);
        };
        tryOnce();
    });
}

// Kill a spawned child and its whole process tree. On Windows a child launched via npm.cmd is the
// root of a tree (npm → node → ts-node-dev/react-scripts); a plain kill() leaves the grandchildren
// running, so use taskkill /T to take the whole tree down.
function killTree(child) {
    if (!child || child.killed) return;
    try {
        if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            child.kill();
        }
    } catch { /* already gone */ }
}

// dev-live only: run the CRA dev server (HMR) pointed at the backend's API port. Returns the port
// the window should load. BROWSER=none stops CRA opening a system browser tab.
function startFrontendDev(apiPort) {
    const env = {
        ...process.env,
        PORT: String(DEV_FRONTEND_PORT),
        BROWSER: 'none',
        REACT_APP_API_URL: `http://localhost:${apiPort}/api`,
    };
    log(`starting CRA dev server on :${DEV_FRONTEND_PORT} (api → :${apiPort})`);
    frontendChild = spawn(npmCmd, ['start'], { cwd: frontendSrcDir, env, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    frontendChild.stdout?.on('data', (d) => log(`[frontend] ${String(d).trimEnd()}`));
    frontendChild.stderr?.on('data', (d) => log(`[frontend:err] ${String(d).trimEnd()}`));
    frontendChild.on('error', (err) => log(`[frontend] spawn error: ${err.message}`));
    frontendChild.on('exit', (code) => { log(`frontend dev server exited code=${code}`); frontendChild = null; });
    return DEV_FRONTEND_PORT;
}

async function startBackend() {
    const cfg = loadConfig();
    const appPort = DEV_LIVE ? DEV_BACKEND_PORT : await getFreePort();
    const pgPort = await getFreePort();

    log(`backendDir=${backendDir}`);
    log(`serverEntry=${serverEntry} exists=${fs.existsSync(serverEntry)}`);
    log(`frontendDir=${frontendDir} exists=${fs.existsSync(frontendDir)}`);
    log(`appPort=${appPort} pgPort=${pgPort} pgDir=${pgDir} devLive=${DEV_LIVE}`);
    // dev-live compiles on the fly via ts-node-dev, so there's no dist/server.js to check for.
    if (!DEV_LIVE && !fs.existsSync(serverEntry)) {
        throw new Error(`Backend not found at ${serverEntry}`);
    }

    const env = {
        ...process.env,
        // Match the shell: a packaged install runs the backend as production; `electron .` dev runs it
        // as development (dev SQL logging, error stacks in responses, correct Sentry environment tag).
        NODE_ENV: app.isPackaged ? 'production' : 'development',
        PGLITE_DIR: pgDir,
        PGLITE_PORT: String(pgPort),
        // The backend connects to PGlite through the ordinary Postgres client; on localhost
        // PGlite accepts any credentials, so these are placeholders.
        DB_HOST: '127.0.0.1',
        DB_PORT: String(pgPort),
        DB_NAME: 'postgres',
        DB_USER: 'postgres',
        DB_PASSWORD: 'postgres',
        UPLOAD_DIR: uploadsDir,
        PORT: String(appPort),
        JWT_SECRET: cfg.jwtSecret,
        // Surface the packaged app version to the backend so /api/health (and thus the UI) reports it.
        APP_VERSION: app.getVersion(),
    };
    if (DEV_LIVE) {
        // The CRA dev server (a separate origin) serves the frontend, so the backend must not also
        // serve a build, and must allow the CRA origin through CORS.
        env.FRONTEND_URL = `http://localhost:${DEV_FRONTEND_PORT}`;
    } else {
        // Packaged/staged: the backend serves the built SPA from this same origin.
        env.FRONTEND_DIR = frontendDir;
    }
    // Provide the (user-supplied, locally-encrypted) Anthropic key only if one is stored. When
    // absent, AI grading simply errors when used — the rest of the app is unaffected.
    const apiKey = loadApiKey();
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    log(`anthropic key configured=${apiKey ? 'yes' : 'no'}`);
    // Hand the (embeddable) Sentry DSN to the backend so it reports its own errors too, and tag its
    // events with the packaged app version so backend releases line up automatically — no
    // deploy-time env var needed.
    if (SENTRY_DSN) env.SENTRY_DSN = SENTRY_DSN;
    env.SENTRY_RELEASE = app.getVersion();

    if (DEV_LIVE) {
        // Hot-reloading backend (ts-node-dev via `npm run dev`) — recompiles on save, no `tsc` step.
        backendChild = spawn(npmCmd, ['run', 'dev'], { cwd: backendDir, env, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
        backendChild.on('error', (err) => log(`[backend] spawn error: ${err.message}`));
    } else {
        backendChild = utilityProcess.fork(serverEntry, [], { cwd: backendDir, stdio: 'pipe', env });
    }

    backendChild.stdout?.on('data', (d) => log(`[backend] ${String(d).trimEnd()}`));
    backendChild.stderr?.on('data', (d) => log(`[backend:err] ${String(d).trimEnd()}`));
    backendChild.on('exit', (code) => {
        log(`backend exited code=${code}`);
        backendChild = null;
        // In dev-live, ts-node-dev owns respawning on save; a crash there shouldn't tear down the
        // whole session (fix the code and it recompiles). Only the packaged path treats it as fatal.
        if (!DEV_LIVE && code !== 0 && !app.isQuitting) {
            dialog.showErrorBox('QC Platform', `The application backend stopped unexpectedly (code ${code}).\n\nDetails were written to:\n${logPath}`);
            app.quit();
        }
    });

    log('waiting for backend health…');
    await waitForHealth(appPort);
    log('backend healthy');
    return appPort;
}

function stopBackend() {
    if (backendChild) {
        // dev-live spawns npm (a process tree); the packaged path uses utilityProcess (a single
        // process that kill() handles directly).
        if (DEV_LIVE) killTree(backendChild); else { try { backendChild.kill(); } catch { /* already gone */ } }
        backendChild = null;
    }
    if (frontendChild) { killTree(frontendChild); frontendChild = null; }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        title: 'UOWA QC Platform',
        // Packaged builds take the window icon from the app executable; in `npm run dev` we point
        // at the generated crest so the dev window/taskbar match.
        ...(app.isPackaged ? {} : { icon: path.join(__dirname, 'build', 'icon.ico') }),
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    // A simple loading screen while the backend spins up. The first launch is noticeably slower
    // (the embedded database initializes and seeds), so we say so; later launches are quick.
    const loadingHtml =
        '<!doctype html><html><head><meta charset="utf-8"></head>' +
        '<body style="font-family:Segoe UI,sans-serif;display:flex;flex-direction:column;gap:10px;' +
        'align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0">' +
        '<div style="font-size:18px">Starting…</div>' +
        '<div style="font-size:13px;color:#94a3b8">The first launch may take up to a minute while the database is prepared.</div>' +
        '</body></html>';
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml));
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });
}

function openSettingsWindow() {
    if (settingsWindow) { settingsWindow.focus(); return; }
    settingsWindow = new BrowserWindow({
        width: 560,
        height: 420,
        title: 'الإعدادات — مفتاح Anthropic API',
        parent: mainWindow || undefined,
        modal: !!mainWindow,
        resizable: false,
        minimizable: false,
        ...(app.isPackaged ? {} : { icon: path.join(__dirname, 'build', 'icon.ico') }),
        webPreferences: {
            preload: path.join(__dirname, 'preload-settings.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    settingsWindow.setMenuBarVisibility(false);
    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
    settingsWindow.on('closed', () => { settingsWindow = null; });
}

// IPC for the settings window only (the main app window has no preload / no IPC surface).
ipcMain.handle('apikey:status', () => ({
    hasKey: hasApiKey(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
}));
ipcMain.handle('apikey:save', async (_e, key) => {
    const trimmed = String(key || '').trim();
    if (!trimmed) throw new Error('الرجاء إدخال مفتاح API.');
    saveApiKey(trimmed);
    log('anthropic key saved');
    const { response } = await dialog.showMessageBox(settingsWindow, {
        type: 'info',
        buttons: ['أعد التشغيل الآن', 'لاحقاً'],
        defaultId: 0,
        title: 'تم حفظ المفتاح',
        // Keep this pure Arabic (no embedded Latin like "API"): the native task dialog renders with
        // an LTR base direction, so a Latin run mid-sentence splits the Arabic into two runs that get
        // reordered (garbled). Single-run Arabic renders correctly.
        message: 'تم حفظ المفتاح بأمان. هل تريد إعادة تشغيل التطبيق لتفعيل التقييم الآلي؟',
    });
    if (response === 0) { app.isQuitting = true; stopBackend(); app.relaunch(); app.exit(0); }
    return { ok: true };
});
ipcMain.handle('apikey:clear', () => { clearApiKey(); log('anthropic key cleared'); return { ok: true }; });

function buildMenu() {
    const template = [
        {
            label: 'ملف',
            submenu: [
                { label: 'الإعدادات — مفتاح Anthropic API…', click: openSettingsWindow },
                { type: 'separator' },
                { role: 'quit', label: 'خروج' },
            ],
        },
        { label: 'تحرير', submenu: [
            { role: 'undo', label: 'تراجع' }, { role: 'redo', label: 'إعادة' }, { type: 'separator' },
            { role: 'cut', label: 'قص' }, { role: 'copy', label: 'نسخ' }, { role: 'paste', label: 'لصق' }, { role: 'selectAll', label: 'تحديد الكل' },
        ] },
        { label: 'عرض', submenu: [
            { role: 'reload', label: 'إعادة تحميل' }, { role: 'togglefullscreen', label: 'ملء الشاشة' },
            ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'أدوات المطور' }]),
        ] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function checkForUpdates() {
    if (!app.isPackaged) return; // updates only make sense for an installed build
    autoUpdater.on('update-downloaded', async () => {
        const { response } = await dialog.showMessageBox({
            type: 'info',
            buttons: ['Restart now', 'Later'],
            defaultId: 0,
            title: 'Update ready',
            message: 'A new version has been downloaded. Restart to apply it?',
        });
        if (response === 0) { app.isQuitting = true; autoUpdater.quitAndInstall(); }
    });
    autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error('[updater]', e));
}

// Single instance: a second launch focuses the existing window instead of starting
// a second backend on the same data dir.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
    });

    app.whenReady().then(async () => {
        try { fs.writeFileSync(logPath, ''); } catch { /* ignore */ } // fresh log per launch
        log(`app start — version=${app.getVersion()} packaged=${app.isPackaged} userData=${userData}`);
        buildMenu();
        createWindow();
        try {
            const apiPort = await startBackend();
            // dev-live: the window loads the CRA dev server (HMR); the backend it just started serves
            // only the API. Otherwise the backend serves both, so the window loads the backend port.
            let loadPort = apiPort;
            if (DEV_LIVE) {
                loadPort = startFrontendDev(apiPort);
                log('waiting for CRA dev server…');
                await waitForHttp(loadPort);
                log('frontend dev server ready');
            }
            log(`loading app at http://localhost:${loadPort}`);
            if (mainWindow) mainWindow.loadURL(`http://localhost:${loadPort}`);
            checkForUpdates();
        } catch (err) {
            log(`STARTUP FAILED: ${err && err.stack || err}`);
            dialog.showErrorBox('QC Platform', `Failed to start:\n${err.message}\n\nDetails were written to:\n${logPath}`);
            app.quit();
        }
    });

    app.on('window-all-closed', () => { app.isQuitting = true; stopBackend(); app.quit(); });
    app.on('before-quit', () => { app.isQuitting = true; stopBackend(); });
}
