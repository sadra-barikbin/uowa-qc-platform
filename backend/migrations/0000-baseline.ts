import type { Migration } from '../utils/migrator';

// Baseline marker. The v1 schema is created by sequelize.sync() (models are the source of truth),
// so this migration intentionally does nothing — it just anchors the migration ledger so every
// install has a known starting point. Real schema changes go in new, later-numbered files.
export const up: Migration['up'] = async () => {
    /* no-op: v1 schema is owned by sync() */
};

export const down: Migration['down'] = async () => {
    /* no-op */
};
