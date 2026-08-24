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
3. Run:
   ```bash
   npm run release
   ```
   This builds and uploads the installer + `latest.yml` to a GitHub Release on the **public**
   `sadra-barikbin/uowa-qc-releases` repo (configured in [`electron-builder.yml`](electron-builder.yml)).
   That repo holds **only the installers** so downloads and auto-update work without authentication,
   while the application source stays in the private `uowa-qc-platform` repo.

Installed apps check the public releases repo on launch, download in the background, and apply on
restart. Releases are created as **drafts** by default — publish the draft on GitHub for it to reach
users (or set `releaseType: release` under `publish:` in `electron-builder.yml` to publish directly).

## Useful scripts

| Script | What it does |
|--------|--------------|
| `npm run stage` | Build backend + frontend and copy them into `resources/` (no packaging). |
| `npm run dev`   | Stage, then run the app via `electron .` (uses the repo's backend/frontend). |
| `npm run pack`  | Stage + produce an unpacked app in `dist/win-unpacked/` (no installer — fast). |
| `npm run build` | Stage + produce the NSIS installer, no publish. |
| `npm run release` | Stage + build + publish to GitHub Releases (needs `GH_TOKEN`). |

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
- **AI grading** works only if an `ANTHROPIC_API_KEY` is available to the backend; the app runs fully
  without it. A future enhancement can expose a settings field storing the key in `config.json`.
