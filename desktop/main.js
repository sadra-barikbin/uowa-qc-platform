const { app, BrowserWindow, dialog, utilityProcess, ipcMain, Menu, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const crypto = require('crypto');

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

async function startBackend() {
    const cfg = loadConfig();
    const appPort = await getFreePort();
    const pgPort = await getFreePort();

    log(`backendDir=${backendDir}`);
    log(`serverEntry=${serverEntry} exists=${fs.existsSync(serverEntry)}`);
    log(`frontendDir=${frontendDir} exists=${fs.existsSync(frontendDir)}`);
    log(`appPort=${appPort} pgPort=${pgPort} pgDir=${pgDir}`);
    if (!fs.existsSync(serverEntry)) {
        throw new Error(`Backend not found at ${serverEntry}`);
    }

    const env = {
        ...process.env,
        NODE_ENV: 'production',
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
        FRONTEND_DIR: frontendDir,
        PORT: String(appPort),
        JWT_SECRET: cfg.jwtSecret,
    };
    // Provide the (user-supplied, locally-encrypted) Anthropic key only if one is stored. When
    // absent, AI grading simply errors when used — the rest of the app is unaffected.
    const apiKey = loadApiKey();
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    log(`anthropic key configured=${apiKey ? 'yes' : 'no'}`);

    backendChild = utilityProcess.fork(serverEntry, [], { cwd: backendDir, stdio: 'pipe', env });

    backendChild.stdout?.on('data', (d) => log(`[backend] ${String(d).trimEnd()}`));
    backendChild.stderr?.on('data', (d) => log(`[backend:err] ${String(d).trimEnd()}`));
    backendChild.on('exit', (code) => {
        log(`backend exited code=${code}`);
        backendChild = null;
        if (code !== 0 && !app.isQuitting) {
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
        try { backendChild.kill(); } catch { /* already gone */ }
        backendChild = null;
    }
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
        title: 'Settings — Anthropic API Key',
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
    if (!trimmed) throw new Error('Please enter an API key.');
    saveApiKey(trimmed);
    log('anthropic key saved');
    const { response } = await dialog.showMessageBox(settingsWindow, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        title: 'API key saved',
        message: 'The API key was saved securely. Restart the app to enable AI grading?',
    });
    if (response === 0) { app.isQuitting = true; stopBackend(); app.relaunch(); app.exit(0); }
    return { ok: true };
});
ipcMain.handle('apikey:clear', () => { clearApiKey(); log('anthropic key cleared'); return { ok: true }; });

function buildMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                { label: 'Settings — Anthropic API Key…', click: openSettingsWindow },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
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
            const port = await startBackend();
            log(`loading app at http://localhost:${port}`);
            if (mainWindow) mainWindow.loadURL(`http://localhost:${port}`);
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
