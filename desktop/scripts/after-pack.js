const fs = require('fs');
const path = require('path');

// electron-builder 26 prunes nested node_modules from extraResources (it treats any node_modules
// under the app dir as the app's own deps and removes those not in desktop/package.json's tree).
// That strips the forked backend's production dependencies, so the packaged app crashes at launch
// with "Cannot find module 'dotenv/config'". This afterPack hook restores them by copying the staged
// backend node_modules (produced by scripts/stage.js) into the packaged app after the prune.
exports.default = async function afterPack(context) {
    const stagedNodeModules = path.join(__dirname, '..', 'resources', 'backend', 'node_modules');
    const packedNodeModules = path.join(context.appOutDir, 'resources', 'backend', 'node_modules');

    if (!fs.existsSync(stagedNodeModules)) {
        throw new Error(`afterPack: staged backend node_modules not found at ${stagedNodeModules} — run stage first`);
    }
    fs.rmSync(packedNodeModules, { recursive: true, force: true });
    fs.cpSync(stagedNodeModules, packedNodeModules, { recursive: true });
    const count = fs.readdirSync(packedNodeModules).length;
    console.log(`  • afterPack: restored backend node_modules (${count} entries) → ${packedNodeModules}`);
};
