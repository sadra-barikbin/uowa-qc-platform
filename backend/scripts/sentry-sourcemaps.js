/*
 * Upload backend source maps to Sentry, tagged with a release.
 *
 * Run this AFTER `npm run build` (it operates on ./dist, which tsc emits with
 * source maps — see "sourceMap": true in tsconfig.json).
 *
 *   SENTRY_AUTH_TOKEN=<token>  npm run sentry:sourcemaps
 *   # or the convenience script that builds first:
 *   SENTRY_AUTH_TOKEN=<token>  npm run release
 *
 * Config (env, with sensible defaults):
 *   SENTRY_AUTH_TOKEN  (required)  auth token with `project:releases` scope
 *   SENTRY_ORG         default: uowa
 *   SENTRY_PROJECT     default: node-express
 *   SENTRY_URL         default: https://de.sentry.io/   (this org is EU-hosted)
 *   SENTRY_RELEASE     default: current git commit SHA
 *
 * `sourcemaps inject` writes debug IDs into the built JS in ./dist, so the code
 * you deploy must be this injected build for symbolication to work.
 */
const path = require('path');
const fs = require('fs');
const { SentryCli } = require('@sentry/cli');

async function main() {
    const distDir = path.join(__dirname, '..', 'dist');
    if (!fs.existsSync(distDir)) {
        console.error('❌  dist/ not found — run `npm run build` first.');
        process.exit(1);
    }
    if (!process.env.SENTRY_AUTH_TOKEN) {
        console.error('❌  SENTRY_AUTH_TOKEN is not set. Create one at Sentry → Settings → Auth Tokens (scope: project:releases) and export it.');
        process.exit(1);
    }

    const options = {
        url: process.env.SENTRY_URL || 'https://de.sentry.io/',
        org: process.env.SENTRY_ORG || 'uowa',
        project: process.env.SENTRY_PROJECT || 'backend',
    };
    const cli = new SentryCli(null, options);

    const release =
        process.env.SENTRY_RELEASE || (await cli.releases.proposeVersion()).trim();

    console.log(`▶  Uploading source maps for release "${release}" → ${options.org}/${options.project}`);

    await cli.releases.new(release);
    await cli.execute(['sourcemaps', 'inject', distDir], true);
    await cli.execute(['sourcemaps', 'upload', '--release', release, distDir], true);
    await cli.releases.finalize(release);

    console.log('✅  Source maps uploaded. Set SENTRY_RELEASE=' + release + ' at runtime to tag events with this release.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
