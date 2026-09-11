// tsc only emits .js, so non-code files under assets/ (the PDF report fonts) never reach dist/.
// This runs right after tsc (see the "build" script) and mirrors assets/ into dist/assets/, so the
// compiled server resolves fonts at ../assets from dist/routes in every deployment — Docker copies
// dist/ wholesale, and the desktop staging (desktop/scripts/stage.js) copies backend/dist into the
// packaged app. Keep this in sync with the font-path resolution in routes/reports.ts.
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..');
const src = path.join(backendDir, 'assets');
const dest = path.join(backendDir, 'dist', 'assets');

if (!fs.existsSync(src)) {
    console.log('copy-assets: no assets/ directory, nothing to copy');
    process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`copy-assets: copied ${path.relative(backendDir, src)} -> ${path.relative(backendDir, dest)}`);
