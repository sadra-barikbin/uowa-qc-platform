# UOWA QC Platform — Desktop App

A self-contained Windows desktop build of the QC platform for a single, non-technical user. It
bundles the React frontend, the Express/TypeScript backend, and an **embedded PostgreSQL database
(PGlite)** into one installer. No Node, no PostgreSQL, no configuration — the user double-clicks an
installer and runs the app; new versions install themselves.

## How it works

The Electron shell ([`main.js`](main.js)) on launch:

1. Resolves per-user writable paths under `%APPDATA%/UOWA QC Platform/` — `pgdata/` (the database),
   `uploads/` (evidence files), `config.json` (a generated JWT secret). **This folder persists across
   app updates** — updates only replace the program files, never the data.
2. Starts the compiled backend (`resources/backend/dist/server.js`) as a child process, which boots
   PGlite on a private local port and serves both the API and the built frontend on one local origin.
3. Waits for `/api/health`, then opens the window on that local URL.
4. Checks GitHub Releases for updates and installs them on the next restart.

### Closing the app during an AI evaluation

A whole-department AI evaluation is one call per indicator and can run for minutes, and the backend
serving it is this shell's child process — so closing the window would abort it mid-call. The app
window carries a one-setter preload ([`preload-app.js`](preload-app.js)) through which the page
reports a run in flight; while one is, closing the window, quitting from the menu, reloading, and
the post-API-key relaunch all ask first ("stay in the app" is the default), and an auto-update
restart prompt is held back until the run finishes. Indicators already graded are saved either way;
only the current one and those after it are lost, and re-running picks the rest up.

First launch seeds a **clean institutional dataset** (real colleges, departments, the 13 indicators,
and a single admin login `admin@uowa.edu.iq` / `Admin@123`) and opens the current month's evaluation
period. It never re-seeds after that.

## Build & release (developer machine)

```bash
cd desktop
npm install
npm run build          # builds backend + frontend, stages them, produces dist/*.exe (no publish)
```

Output lands in `desktop/dist/`:

- `UOWA QC Platform Setup <version>.exe` — the one-click installer to hand to the user (first time).
- `latest.yml` + `*.blockmap` — the auto-update feed; must sit next to the installer in the Release.

### Publishing an update (auto-update)

1. Bump `version` in [`package.json`](package.json).
2. Set a GitHub token with `repo` scope once in your shell: `export GH_TOKEN=...` (Windows:
   `$env:GH_TOKEN="..."`). It stays on your machine and is never shipped.
3. (Optional) Set `SENTRY_DSN_BACKEND=...`, `SENTRY_DSN_FRONTEND=...` (error monitoring) and
   `SENTRY_AUTH_TOKEN=...` (source-map upload) — see below.
4. Run:
   ```bash
   npm run release
   ```
   This builds and uploads the installer + `latest.yml` to a GitHub Release on
   `sadra-barikbin/uowa-qc-platform` (configured in [`electron-builder.yml`](electron-builder.yml)).

Installed apps check that repo's Releases on launch, download in the background, and apply on restart.

## Useful scripts

| Script | What it does |
|--------|--------------|
| `npm run stage` | Build backend + frontend and copy them into `resources/` (no packaging). |
| `npm run dev`   | Stage (full build), then run the app via `electron .` — the staged production bundle. |
| `npm run dev:live` | **Hot-reload dev loop, no rebuilds** — see below. Use this for iterating on code. |
| `npm run pack`  | Stage + produce an unpacked app in `dist/win-unpacked/` (no installer — fast). |
| `npm run build` | Stage + produce the NSIS installer, no publish. |
| `npm run release` | Stage + build + publish to GitHub Releases (needs `GH_TOKEN`). |

### Hot-reload dev loop (`npm run dev:live`)

For iterating on the app without rebuilding each time:

```bash
cd desktop
npm run dev:live
```

The Electron shell launches the backend through **ts-node-dev** (recompiles on save, no `tsc`) and
the frontend through the **CRA dev server** (HMR, no `react-scripts build`), then loads the CRA URL in
the window. Edit anything under `backend/` or `frontend/src/` and the change appears live — the
backend restarts itself, the frontend hot-reloads in place. All the real desktop behaviours are kept:
the **embedded PGlite database** (same `%APPDATA%` data dir as a normal run), the **File → Settings —
Anthropic API Key…** menu, and auto-update stays off (dev only).

- One-time: `npm install` in `backend/`, `frontend/`, and `desktop/` so the dev toolchains exist.
- Uses fixed ports **5000** (backend API) and **3001** (frontend); stop anything already on them
  (e.g. a separate `backend`/`frontend` dev server) before starting.
- The first launch is slow while the CRA dev server does its initial compile and PGlite seeds; the
  window shows the "Starting…" screen until both are ready. Later reloads are instant.
- `npm run dev` (staged) is still the way to smoke-test the actual production bundle before packaging.

## Notes / one-time machine setup

- **Building the installer needs symlink privilege.** electron-builder extracts a `winCodeSign` cache
  that contains macOS symlinks. On Windows this requires **Developer Mode** enabled (Settings →
  Privacy & security → For developers) *or* running the build terminal as Administrator once. Without
  it the build fails at "Cannot create symbolic link". This only affects the build machine, never the
  user.
- **The installer is unsigned.** On first install, Windows SmartScreen shows a one-time
  "unknown publisher" warning ("More info" → "Run anyway"). Auto-updates still work unsigned. To
  remove the warning, add a code-signing certificate later and set `CSC_LINK`/`CSC_KEY_PASSWORD`.
- **App icon** is the University of Warith Al-Anbiya crest (`build/icon.ico`). It's generated from
  `frontend/public/uowa-logo-b.svg` by `npm run icon` (a committed artifact — a normal build doesn't
  re-run it). Re-run that script if the source logo changes.
- **AI grading (Anthropic API key)** is optional; the app runs fully without it. The key is **never
  shipped** — the user adds their own via **File → Settings — Anthropic API Key…**. It's encrypted at
  rest with Electron `safeStorage` (Windows DPAPI, tied to that Windows account) in
  `%APPDATA%/…/anthropic.key.enc` and injected into the backend's `ANTHROPIC_API_KEY` at launch; it
  never leaves the machine. Changing it takes effect after a restart (the Settings window offers to
  restart). A shipped API key would be trivially extractable from the app bundle, so this is the only
  safe pattern for a distributed client.
- **Error monitoring (Sentry)** is optional and **off unless a DSN is baked in at build time**, using
  **two Sentry projects** — one for the Node side, one for the browser side:
  - `SENTRY_DSN_BACKEND` → the **backend** (`@sentry/node`) **and the Electron shell** (`@sentry/electron`),
    since the shell is also a Node process. `scripts/stage.js` writes it into `sentry.json` (gitignored,
    packed into the app); the shell reads it and passes it to the backend child as `SENTRY_DSN`.
  - `SENTRY_DSN_FRONTEND` → the **frontend** (`@sentry/react`), compiled into the React bundle as
    `REACT_APP_SENTRY_DSN`.

  **Source maps** are uploaded automatically when `SENTRY_AUTH_TOKEN` is set (scope `project:releases`):
  `scripts/stage.js` builds with source maps, injects debug IDs, uploads them to each project under the
  **app `version`** as the release (matching what the running app reports — the shell tags events with
  `app.getVersion()`), then strips the `.map` files from the shipped bundle. Without the token the upload
  is skipped and no maps ship. The auth token is a build-machine secret — keep it in your shell like
  `GH_TOKEN`, never in the app.

  So a full release looks like
  `SENTRY_DSN_BACKEND=… SENTRY_DSN_FRONTEND=… SENTRY_AUTH_TOKEN=… GH_TOKEN=… npm run release`.
  Unlike the Anthropic key, a Sentry **DSN is safe to embed** — it only permits *sending* events, grants
  no access or spend — so it ships in the app. With no DSN set, all three surfaces initialize to a no-op.
