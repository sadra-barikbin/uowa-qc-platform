import type { Migration } from '../utils/migrator';

// Adds `evaluation_complete` to the notifications.type enum — the type used by the notification
// emitted when a background AI-evaluation run finishes (utils/notifications.ts,
// notifyAiEvaluationComplete). Sequelize names the enum after the table+column, so the Postgres
// type is `enum_notifications_type` (not the hand-written schema.sql name).
//
// On a fresh install sync() already builds the enum with this value and this migration is
// baseline-stamped; on an existing install it runs to add the value in place. ADD VALUE is not
// wrapped in a transaction by Umzug here, and IF NOT EXISTS makes a re-run a no-op.
export const up: Migration['up'] = async ({ context: qi }) => {
    await qi.sequelize.query(
        `ALTER TYPE "enum_notifications_type" ADD VALUE IF NOT EXISTS 'evaluation_complete'`,
    );
};

export const down: Migration['down'] = async () => {
    // Postgres cannot DROP a value from an enum without recreating the type and rewriting every
    // dependent column; the unused value is harmless, so the down migration is intentionally a no-op.
};
