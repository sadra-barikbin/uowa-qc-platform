import path from 'path';
import { Sequelize, QueryInterface } from 'sequelize';
import { Umzug, SequelizeStorage } from 'umzug';

// Versioned schema migrations for the packaged desktop app — the Sequelize-world equivalent of
// Alembic. `SequelizeMeta` is the applied-migration ledger, files in ../migrations are the
// versions (each exports `up`/`down`), and umzug.up() is `alembic upgrade head`.
//
// Startup contract (see server.ts): sync() first builds the current model schema, then:
//   • fresh install  → baseline-stamp: record every migration as applied WITHOUT running it, since
//                      sync() already produced the latest shape. Nothing to alter on an empty DB.
//   • existing DB    → umzug.up(): run only the migrations added since this user's last version,
//                      bringing their older schema (and data) up to the current release.
//
// Discipline: every change to models/index.ts ships with a matching migration in the same commit,
// so fresh installs (via sync) and upgraded installs (via migrations) converge on the same schema.

export type Migration = {
    up: (params: { context: QueryInterface; sequelize: Sequelize }) => Promise<void>;
    down: (params: { context: QueryInterface; sequelize: Sequelize }) => Promise<void>;
};

function buildUmzug(sequelize: Sequelize) {
    const storage = new SequelizeStorage({ sequelize });
    const umzug = new Umzug({
        // Compiled output: this file lives in dist/utils, migrations in dist/migrations.
        migrations: { glob: ['../migrations/*.js', { cwd: __dirname }] },
        context: sequelize.getQueryInterface(),
        storage,
        logger: console,
    });
    return { umzug, storage };
}

export async function runMigrations(sequelize: Sequelize, opts: { fresh: boolean }): Promise<void> {
    const { umzug, storage } = buildUmzug(sequelize);

    if (opts.fresh) {
        // Baseline-stamp: the schema is already current (sync just built it), so mark all migrations
        // as applied without executing them. A future release's new migrations will then run for
        // this install like any other upgrade.
        const pending = await umzug.pending();
        for (const m of pending) {
            await storage.logMigration({ name: m.name });
        }
        if (pending.length) {
            console.log(`✅  Baseline-stamped ${pending.length} migration(s) on fresh database`);
        }
        return;
    }

    const applied = await umzug.up();
    if (applied.length) {
        console.log(`✅  Applied ${applied.length} pending migration(s): ${applied.map(m => m.name).join(', ')}`);
    } else {
        console.log('✅  Database schema already up to date');
    }
}

// Convenience for a standalone migrate script (optional; not used by the desktop launch).
export async function migrateUp(sequelize: Sequelize): Promise<void> {
    const { umzug } = buildUmzug(sequelize);
    await umzug.up();
}

export const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
