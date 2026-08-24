import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// Embedded Postgres for the packaged desktop app.
//
// PGlite is Postgres compiled to WASM (no native binary, no separate server to install).
// PGLiteSocketServer wraps that in-process instance behind a local TCP socket that speaks the
// real Postgres wire protocol, so the rest of the backend connects through the ordinary `pg`
// driver / Sequelize `postgres` dialect with zero code changes — every existing query, JSONB
// column and SQL view keeps working exactly as it does against a real Postgres.
//
// Only started when PGLITE_DIR is set (i.e. the desktop launch). In normal dev the backend talks
// to a real Postgres and this file is never touched.

export interface PgliteHandle {
    stop: () => Promise<void>;
}

let handle: PgliteHandle | null = null;

export async function startPglite(): Promise<PgliteHandle> {
    if (handle) return handle;

    const dataDir = process.env.PGLITE_DIR;
    if (!dataDir) throw new Error('startPglite() called without PGLITE_DIR set');
    const host = process.env.PGLITE_HOST || '127.0.0.1';
    const port = Number(process.env.PGLITE_PORT) || 55432;

    // Persisted to disk under the app's userData dir; survives launches and app updates.
    const db = await PGlite.create({ dataDir });
    const server = new PGLiteSocketServer({ db, host, port });
    await server.start();
    console.log(`✅  Embedded Postgres (PGlite) listening on ${host}:${port} (data: ${dataDir})`);

    handle = {
        async stop() {
            await server.stop();
            await db.close();
            handle = null;
        },
    };
    return handle;
}
