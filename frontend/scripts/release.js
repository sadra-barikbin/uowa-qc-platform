/*
 * Build the frontend with a Sentry release stamped in, then upload its source maps.
 *
 *   SENTRY_AUTH_TOKEN=<token>  SENTRY_PROJECT=<react-project-slug>  npm run release
 *
 * This drives the whole release build so the release name used at BUILD time
 * (embedded as REACT_APP_SENTRY_RELEASE, read by src/instrument.js) matches the
 * one used to UPLOAD the maps.
 *
 * Config (env):
 *   SENTRY_AUTH_TOKEN  (required)  auth token with `project:releases` scope
 *   SENTRY_PROJECT     (required)  slug of your FRONTEND Sentry project (React)
 *   SENTRY_ORG         default: uowa
 *   SENTRY_URL         default: https://de.sentry.io/   (this org is EU-hosted)
 *   SENTRY_RELEASE     default: current git commit SHA
 *
 * `sourcemaps inject` writes debug IDs into ./build, so deploy the build/ produced
 * by this script (not a separate `npm run build`).
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { SentryCli } = require('@sentry/cli');

async function main() {
    if (!process.env.SENTRY_AUTH_TOKEN) {
        console.error('❌  SENTRY_AUTH_TOKEN is not set. Create one at Sentry → Settings → Auth Tokens (scope: project:releases) and export it.');
        process.exit(1);
    }
    const options = {
        url: process.env.SENTRY_URL || 'https://de.sentry.io/',
        org: process.env.SENTRY_ORG || 'uowa',
        project: process.env.SENTRY_PROJECT || 'frontend',
    };
    const cli = new SentryCli(null, options);

    const release =
        process.env.SENTRY_RELEASE || (await cli.releases.proposeVersion()).trim();

    // 1) Production build with the release stamped into the bundle so runtime
    //    events carry the same release the maps are uploaded under.
    //    Invoke react-scripts via the current Node binary (not npm.cmd) so this
    //    works cross-platform — Node refuses to spawn .cmd files without a shell.
    console.log(`▶  Building frontend for release "${release}"`);
    const projectRoot = path.join(__dirname, '..');
    const reactScripts = require.resolve('react-scripts/bin/react-scripts.js', {
        paths: [projectRoot],
    });
    const build = spawnSync(process.execPath, [reactScripts, 'build'], {
        stdio: 'inherit',
        cwd: projectRoot,
        env: { ...process.env, REACT_APP_SENTRY_RELEASE: release },
    });
    if (build.status !== 0) {
        console.error('❌  Frontend build failed.');
        process.exit(build.status || 1);
    }

    // 2) Inject debug IDs + upload source maps for the freshly-built assets.
    const buildDir = path.join(__dirname, '..', 'build');
    if (!fs.existsSync(buildDir)) {
        console.error('❌  build/ not found after build step.');
        process.exit(1);
    }
    console.log(`▶  Uploading source maps → ${options.org}/${options.project}`);
    await cli.releases.new(release);
    await cli.execute(['sourcemaps', 'inject', buildDir], true);
    await cli.execute(['sourcemaps', 'upload', '--release', release, buildDir], true);
    await cli.releases.finalize(release);

    console.log('✅  Release "' + release + '" built and source maps uploaded. Deploy the build/ directory produced here.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
