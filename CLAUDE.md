# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A platform for a university's QC (quality control) department to run its monthly evaluation cycle: faculty
departments upload evidence documents against a set of indicators, the QC unit reviews and scores that evidence,
and scores roll up automatically to department- and college-level reports. It replaces a manual process built on
a shared Google Drive folder plus a hand-maintained Excel workbook (one sheet per indicator + two aggregation
sheets). The backend's Excel export (`GET /api/reports/export/excel`) reproduces that same sheet layout.

The **backend is TypeScript**; the **frontend is still plain JS and targets the old, pre-redesign API shape**
(see "Known gap" below) — do not assume the two are wired together.

## Commands

All backend commands run from `backend/`:

```bash
npm install
npm run dev         # ts-node-dev, hot reload, http://localhost:5000
npm run typecheck   # tsc --noEmit — run this after any backend change
npm test            # jest — unit tests for pure orchestration logic (see below)
npm run build       # compiles to dist/
npm start           # node dist/server.js (run build first)
npm run seed        # ts-node utils/seedData.ts — DROPS AND RECREATES ALL TABLES (sequelize.sync({force:true}))
```

The only automated tests are Jest unit tests for pure, self-contained orchestration logic (currently
`backend/utils/aiJobs.test.ts`, co-located as `*.test.ts` per `backend/jest.config.js`). They mock `../models`
and `./aiEvaluator`, so nothing touches Postgres or the Anthropic API — there's no integration/e2e suite, and
routes, views, and the frontend are still verified by typecheck/build plus manual browser testing. Add a
`*.test.ts` next to any similarly pure module you introduce; don't reach for tests that would need a live DB.
CI (`.github/workflows/ci.yml`) runs backend `typecheck` + `test` and the frontend `build` on every PR.

Frontend, from `frontend/`: `npm install`, `npm start` (proxies `/api` to `localhost:5000`), `npm run build`.

Full stack via Docker: `docker-compose up -d` from the repo root, then
`docker exec univ_backend node dist/utils/seedData.js` to seed. `backend/Dockerfile` is a multi-stage build
(`npm run build` in a build stage, then only `dist/` + prod deps in the final image).

Postgres connection is read from `backend/.env` (copy from `backend/.env.example`). Note: `docker-compose.yml`
substitutes `${DB_PASSWORD}`/`${JWT_SECRET}` from a repo-root `.env`, but the root `.env` currently defines
`POSTGRES_PASSWORD` instead (pre-existing mismatch) — those two vars need to actually be named `DB_PASSWORD` and
`JWT_SECRET` at the repo root for docker-compose to pick them up instead of silently falling back to its
hardcoded defaults.

## Desktop app (packaged, single-user distribution)

`desktop/` is an Electron shell that ships the whole stack as one installable, auto-updating Windows app
for a single non-technical user (see `desktop/README.md`). It runs the **same** compiled backend as a child
process, but with an **embedded PostgreSQL (PGlite)** database instead of a server Postgres: the backend
starts `PGLiteSocketServer` (`backend/utils/pglite.ts`) on a local port and Sequelize connects to it through
the ordinary `postgres` dialect — so **no models/queries/SQL change between dev and desktop**. Everything is
switched on by env vars the shell sets (`PGLITE_DIR`, `FRONTEND_DIR`, `UPLOAD_DIR`, `PORT`, `JWT_SECRET`);
when they're unset the backend behaves exactly as before. The DB + uploads live under Electron `userData` and
survive updates.

Two backend behaviours are desktop-only (guarded by `PGLITE_DIR`, in `server.ts`'s `start()`):
- **Clean first-run seed** (`backend/utils/bootstrap.ts` `ensureSeeded`): real colleges/departments/13
  indicators + one admin, seeded only when the DB is empty (`User.count() === 0`). It reuses the exported
  `INDICATOR_DATA`/`COLLEGE_DATA`/`EXCLUDED_FROM_COMPOSITE` from `seedData.ts`. Note `seedData.ts`'s full demo
  `seed()` now only runs under `if (require.main === module)` — importing it must stay side-effect-free, or it
  would drop every table via `sync({ force: true })`.
- **Migrations, not `sync({ alter })`** (`backend/utils/migrator.ts`, `backend/migrations/`): schema evolution
  for an installed user's real data uses **Umzug** (the Sequelize-world Alembic; `SequelizeMeta` is the ledger).
  On a fresh DB, `sync()` builds the schema and all migrations are baseline-stamped; on an existing DB,
  `umzug.up()` applies only the new ones. **Discipline: every change to `models/index.ts` ships with a matching
  migration in the same commit** — `sync()` keeps fresh installs correct, the migration keeps existing installs
  correct. See `backend/migrations/README.md`.

## Architecture

### Domain model (the part that takes multiple files to understand)

The evaluation flow is a chain of five entities, all defined in `backend/models/index.ts` and
`database/schema.sql`:

```
EvaluationPeriod --< PeriodIndicator >-- Indicator --< IndicatorCriterion >-- Submission / Evaluation
```

- **`EvaluationPeriod`**: one monthly cycle, with a `status` (`draft → open → under_review → published →
  closed`) and a `submission_deadline`.
- **`Indicator`** + **`IndicatorCriterion`**: indicators are reusable/dynamic definitions; each indicator has one
  or more weighted criteria. A criterion's `criterion_type` determines how its score is derived:
  - `checklist` / `percentage`: score entered directly by the reviewer.
  - `ratio`: score is computed server-side from `raw_values.numerator/denominator`, capped at 1 (see
    `computeRatioScore` in `routes/evaluations.ts`).
  - `score_100`: reviewer enters 0–100, stored internally as `score/100`.
- **`PeriodIndicator`**: join table between a period and the indicators active *for that period*, each with its
  own `weight`. This is what lets indicators change month to month — creating a new period can clone a previous
  period's indicator set (`POST /api/periods` with `clone_from_period_id`) or start from every active indicator.
- **`Submission`** + **`SubmissionDocument`**: a department's evidence (notes + uploaded files) for one
  `(period, department, criterion)` triple. Access is gated by `DepartmentUser` — a `dept_rep` can only touch
  submissions for departments they're assigned to (`assertDepartmentAccess` in `routes/submissions.ts`).
- **`Evaluation`**: the reviewer's (or, eventually, AI's — see `evaluation_method`/`ai_confidence`/`ai_rationale`)
  score for a `(period, department, criterion)` triple. It's independent of `Submission` (nullable
  `submission_id`) so a department that submitted nothing can still be scored (typically 0).

### Aggregation is views, not application code

`indicator_scores` → `department_period_scores` → `college_period_scores` are plain SQL views (defined in both
`database/schema.sql` and `backend/utils/ensureViews.ts`) that do the weighted rollups. `utils/scores.ts` just
queries them via `sequelize.query`. If you add a new aggregation, prefer extending these views over computing
rollups in JS — the dashboard, reports, and evaluations routes all read from the same three views.

**`score`/`final_score` is `NULL` only when *nothing* has been evaluated yet** — the moment even one criterion
has a score, the rest are treated as 0 in the weighted average (so a half-reviewed department shows a real,
dragged-down percentage, not a missing one). This is deliberate — untouched vs. reviewed-and-failing need to look
different in the UI (`لم يُقيَّم بعد` vs. `0%`) — and it's easy to regress: an earlier version of these views
used `COALESCE(e.score, 0)` unconditionally, which made every unevaluated row read as a real 0% instead of
"not yet reviewed" (caught via manual browser testing, not by any type or lint check). If you touch these
`CASE` expressions, keep the `COUNT(e.score) = 0 THEN NULL` guard.

**Non-obvious gotcha**: `sequelize.sync({ alter: true })` (used on every dev boot) fails if these views still
exist, because Postgres won't let you `ALTER` a column that a view depends on. `server.ts` and `seedData.ts` both
call `dropViews()` before `sync()` and `ensureViews()` after — if you add a new one-off script that calls
`sequelize.sync()`, follow the same drop → sync → recreate order.

`database/schema.sql` is a hand-maintained reference (e.g. for `psql -f schema.sql` per the README's "manual
setup" path) — it is **not** what actually creates the tables in normal dev/seed use, Sequelize's `sync()` is.
When you change a model in `models/index.ts`, update `schema.sql` to match so the two don't drift.

### Roles

`admin` (QC unit, full control) / `qc_head` (can review/score evaluations and update departments, but indicator,
period, user, and notification management stay `admin`-only) / `dept_rep` (uploads evidence, scoped to assigned
departments only) / `viewer` (read-only). Enforced via `authorize(...roles)` per-route in `middleware/auth.ts`
plus the separate per-department `assertDepartmentAccess` check described above — `authorize()` alone doesn't
cover the "own department only" restriction, and the two checks are combined differently in each route file, so
check the actual `authorize(...)` call rather than assuming a role's permissions.

### TypeScript conventions

Sequelize models use the class-based `Model<InferAttributes<X>, InferCreationAttributes<X>>` pattern (not
`sequelize.define`) so attributes and associations are typed without decorators. Association properties on a
model class (e.g. `Department.college`) are typed `NonAttribute<...>` and only populated when eager-loaded via
`include` — they'll be `undefined` otherwise, not `null`.

`tsconfig.json` intentionally leaves `noImplicitReturns` and `noUnusedParameters` off — they fight Express's
`return res.status(400).json(...)` early-exit idiom and `(req, res)` handler signatures with no bug-catching
value. Don't re-enable them without expecting a lot of unrelated churn.

`req.user` is typed via `backend/types/express.d.ts` (a global `Express.Request` augmentation), not per-route
casting.

### Frontend is wired to the current API

`frontend/src/utils/api.js` targets the current route set (`/periods`, `/indicators`, `/submissions`,
`/evaluations`, etc.), not the old flat metric-scoring API. `Submissions.js` (dept rep evidence upload) and
`Evaluations.js` (reviewer scoring) are the two pages that implement the actual per-criterion workflow — both
drive off `GET /api/{submissions,evaluations}/matrix?period_id=&department_id=`, which returns one row per
active criterion merged with its submission/evaluation state. `Evaluations.js` has to branch UI per
`criterion_type` and get the payload shape right for each: `checklist`/`percentage` send `score` as an
already-divided 0–1 fraction, `score_100` sends the raw 0–100 value (the backend divides it), and `ratio` sends
`raw_values: {numerator, denominator}` with no `score` at all — get this wrong and `POST /api/evaluations`
rejects it. `DepartmentDetail.js` links out to whichever of those two pages the signed-in role can use, with
`?period=&department=` query params the target page pre-fills from.

Two backend routes (`GET /api/submissions`, `GET /api/evaluations`, listing without a `department_id` filter)
were gated with `authorize()` during the frontend sync, since they had no role check at all — a `dept_rep` or
`viewer` could otherwise omit `department_id` and read every department's submissions/evaluations unscoped.

### Seed data reflects the real institution

`backend/utils/seedData.ts` isn't placeholder data — the colleges, departments, and 13 indicators (with their
exact weighted criteria, e.g. the 7-step program-accreditation checklist) were reconstructed from the
department's actual monthly report. `قواعد الامتثال` (compliance rules) is seeded as `is_active: false` on
`PeriodIndicator` deliberately, matching the real report where that indicator is tracked but excluded from the
composite score.
