# Database migrations (desktop app)

These are [Umzug](https://github.com/sequelize/umzug) migrations — the Sequelize-world equivalent
of Python's Alembic. They keep an **installed user's real data** correct across app updates.

## How it works at startup (see `../server.ts`)

The packaged desktop app boots the DB like this:

```
startPglite → sequelize.sync() → runMigrations({ fresh }) → ensureViews → ensureSeeded
```

- **Fresh install** (empty DB): `sync()` builds the current schema directly from the models, then
  every migration here is **baseline-stamped** (recorded as applied without running).
- **Existing install** (updating): only the migrations added since that user's last version run
  (`umzug.up()`), transforming their older schema — and its data — up to the current release.

## The one rule

**Every change to `models/index.ts` ships with a matching migration in the same commit.**

`sync()` keeps *new* installs correct; the migration keeps *existing* installs correct. If you skip
the migration, users who update from an older version get a stale schema.

## Adding a migration

Create a new file named so it sorts **after** every existing one, e.g.
`0001-add-foo-to-bar.ts`:

```ts
import type { Migration } from '../utils/migrator';

export const up: Migration['up'] = async ({ context: qi }) => {
    await qi.addColumn('bars', 'foo', { type: DataTypes.STRING, allowNull: true });
};

export const down: Migration['down'] = async ({ context: qi }) => {
    await qi.removeColumn('bars', 'foo');
};
```

`qi` is the Sequelize `QueryInterface` (`addColumn`, `changeColumn`, `renameColumn`, `sequelize.query`
for data backfills, …). Unlike Alembic there is no reliable autogenerate — write the `up`/`down` by
hand. `npx sequelize-cli migration:generate --name add-foo` can scaffold an empty file.
