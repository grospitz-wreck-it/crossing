# OpenBoards refresh worker (shadow mode)

This worker is intentionally separate from `workers/mobilithek-refresh`. It reads the
same active crossing demand but writes only to the OpenBoards-specific tables. It
does not modify `mobilithek_train_snapshot` and is not connected to the forecast.

## Required database migrations

Apply these migrations to the same Turso database before running the worker:

1. `packages/db-api-client/sql/008_openboards_scheduler.sql`
2. `packages/db-api-client/sql/009_openboards_observations.sql`

Migration 008 creates the persistent queue and the account-wide request-slot row.
Migration 009 creates the isolated observation and refresh-run tables.

## Required Worker secrets / variables

Secrets:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `DB_OPENBOARDS_CLIENT_ID`
- `DB_OPENBOARDS_API_KEY`

Optional variables:
- `OPENBOARDS_BATCH_SIZE` (default 5, maximum 20)
- `OPENBOARDS_MAX_JOBS_PER_RUN` (default 20, maximum 20)
- `OPENBOARDS_CORE_INTERVAL_MS` (default 60000)
- `OPENBOARDS_EXPLORATORY_INTERVAL_MS` (default 300000)

The worker uses a persistent Turso reservation with a 150 ms minimum spacing
(about 6.7 requests/second) before each upstream request. This is deliberately
below the documented 10 requests/second product limit. The client also retains
its per-runtime guard.

## Scheduling and manual execution

The Wrangler configuration schedules one run per minute. To deploy explicitly
from the repository root after migrations and secrets are configured:

```sh
npx wrangler deploy --config workers/openboards-refresh/wrangler.jsonc
```

`GET /health` is a read-only health response. `GET /run` performs a refresh
and writes only to the OpenBoards queue, observations and run-log tables.
Do not expose `/run` publicly without protecting it if the Worker is deployed
with a public route.

## Demand cohorts

- OWL stations are assigned priority 10 and a default 60-second interval.
- Other active test/exploratory stations are assigned priority 100 and a
  default 300-second interval.
- EVAs are deduplicated across crossings and batched separately by priority.
- Primary reference EVAs are retained even when the optional station catalogue
  has no matching display name. Secondary through-rule station names are added
  only when they resolve exactly against the station catalogue.

## Safety boundary

- A successful upstream response replaces only the corresponding EVA/direction
  board rows. Failed requests leave the last successful observations untouched.
- Observations expire after their event time plus one hour, with a minimum
  retention of 30 minutes after collection.
- This is observation collection only. No OpenBoards observation is currently
  used to create or alter a user-facing prediction.
- Do not retire Mobilithek feeds until multi-day shadow comparisons demonstrate
  equivalent or better event coverage and crossing-time accuracy.
## Prediction boundary

The shared `TrainObservation` contract is defined in
`packages/shared-types/src/index.ts`. The DB client exposes
`getOpenBoardsObservations()` and `toTrainObservation()` for later shadow
comparison and prediction work. OpenBoards route data is always marked
`partial` or `unknown`; it is never promoted to a complete route merely
because origin, destination and via references are present.

The existing Timetables-based forecast path (plan + fchg merge, route checks,
configured offsets and two-observation interpolation) remains unchanged.
This worker does not replace or bypass it.
