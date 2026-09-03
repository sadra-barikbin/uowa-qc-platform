import { Sequelize } from 'sequelize';

// In desktop mode the backend talks to embedded PGlite through PGLiteSocketServer, which by
// default accepts only ONE connection at a time (no concurrency — see utils/pglite.ts). A pool
// with max > 1 opens extra sockets as soon as requests arrive in parallel (e.g. the dashboard
// firing several API calls right after login), and every connection beyond the first is reset
// with `ECONNRESET`. That surfaces both as escaped 500s (Sentry) and, via the authenticate
// middleware's catch block, as a spurious 401 that bounces the user back to the login page.
// Serialising all queries onto a single connection matches PGlite's single-connection nature and
// is fine for the single-user desktop app. Server Postgres keeps the normal 10-connection pool.
const isPglite = !!process.env.PGLITE_DIR;

export const sequelize = new Sequelize(
    process.env.DB_NAME || 'university_platform',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'password',
    {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        dialect: 'postgres',
        logging: process.env.NODE_ENV === 'development' ? console.log : false,
        pool: { max: isPglite ? 1 : 10, min: 0, acquire: 30000, idle: 10000 },
        define: { timestamps: true, underscored: true },
    }
);
