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

const run = (cmd, cwd) => {
    console.log(`\n$ ${cmd}   (in ${path.relative(rootDir, cwd) || '.'})`);
    execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1', GENERATE_SOURCEMAP: 'false' } });
};

// 1. Compile the backend (TypeScript -> dist/) and build the frontend.
run('npm run build', backendDir);
run('npm run build', frontendDir);

// 2. Fresh staging dir.
fs.rmSync(resourcesDir, { recursive: true, force: true });
fs.mkdirSync(stagedBackend, { recursive: true });

// 3. Stage the backend: compiled code + manifests, then production-only dependencies.
fs.cpSync(path.join(backendDir, 'dist'), path.join(stagedBackend, 'dist'), { recursive: true });
for (const f of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(backendDir, f), path.join(stagedBackend, f));
}
console.log('\nInstalling backend production dependencies into resources/backend …');
run('npm ci --omit=dev --ignore-scripts', stagedBackend);

// 4. Stage the frontend build.
fs.cpSync(path.join(frontendDir, 'build'), stagedFrontend, { recursive: true });

console.log('\n✅  Staged backend + frontend into desktop/resources/');
