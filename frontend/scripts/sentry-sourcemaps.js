/*
 * Upload the frontend's built source maps to Sentry, tagged with a release.
 *
 * Run this AFTER `npm run build` has produced ./build WITH source maps
 * (GENERATE_SOURCEMAP=true). It injects debug IDs into the built JS and uploads
 * the maps — it does NOT build. The desktop release drives this (see
 * desktop/scripts/stage.js); it can also be run standalone.
 *
 *   SENTRY_AUTH_TOKEN=<token> SENTRY_RELEASE=<release> npm run sentry:sourcemaps
 *
 * Config (env, with sensible defaults):
 *   SENTRY_AUTH_TOKEN  (required)  auth token with `project:releases` scope
 *   SENTRY_RELEASE     default: current git commit SHA
 *   SENTRY_ORG         default: uowa
 *   SENTRY_PROJECT     default: frontend
 *   SENTRY_URL         default: https://de.sentry.io/   (this org is EU-hosted)
 *
 * `sourcemaps inject` writes debug IDs into ./build, so the code you ship must be
 * this injected build for symbolication to work.
 */
const path = require('path');
const fs = require('fs');
const { SentryCli } = require('@sentry/cli');

async function main() {
    const buildDir = path.join(__dirname, '..', 'build');
    if (!fs.existsSync(buildDir)) {
        console.error('❌  build/ not found — run `npm run build` first.');
        process.exit(1);
    }
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

    console.log(`▶  Uploading frontend source maps for release "${release}" → ${options.org}/${options.project}`);

    await cli.releases.new(release);
    await cli.execute(['sourcemaps', 'inject', buildDir], true);
    await cli.execute(['sourcemaps', 'upload', '--release', release, buildDir], true);
    await cli.releases.finalize(release);

    console.log('✅  Frontend source maps uploaded.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
