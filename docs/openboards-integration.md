# OpenBoards integration – staged rollout

## Current state

The repository currently uses the DB Timetables API in
`packages/db-api-client/src/officialTimetableClient.ts` and Mobilithek snapshots
for route-aware train detection. OpenBoards is added as an isolated, read-only
client. It is **not** connected to the live crossing forecast and does not
replace or disable either existing source.

## Credentials

The existing server-side Vercel variables `DB_CLIENT_ID` and `DB_API_KEY`
are present for Preview and Production. A real OpenBoards request succeeded
with these credentials on 19 November 2026. No credential values are stored
in the repository or returned by the probe.

The client also accepts dedicated server-side variables:

- `DB_OPENBOARDS_CLIENT_ID`
- `DB_OPENBOARDS_API_KEY`

For compatibility with an existing DB Marketplace setup, it falls back to
`DB_CLIENT_ID` and `DB_API_KEY`. Never expose either credential to browser
code or commit them to the repository.

## API behavior

- Base URL: `https://apis.deutschebahn.com/db-api-marketplace/apis/open-boards/v1`
- POST `/arrivals` or POST `/departures`
- Request station list: `stopPlaceOrStation.evaNumbers`
- Request time: `timeWindow.timeStart`
- The client currently returns raw JSON; normalization into the crossing
  forecast model is a separate next step.
- EVA batching defaults to 5. The public documentation confirms an EVA array,
  but does not state its maximum size. The batch size can be changed at call
  time after testing.
- Short in-process cache: 20 seconds; duplicate in-flight calls are coalesced.
- No Turso writes, no persistent raw payload storage, no automatic retries.

## Initial real-data validation – 19 November 2026

The protected Preview probe requested arrivals and departures for 17 distinct
EVA numbers from three active crossing areas:

- Kaarst: S28 results were returned.
- Gelsenkirchen-Buer: RB43, RE14 and S9 results were returned.
- Kirchlengern corridor: results included RB61, RB71, RE62, RE3, S2 and
  additional regional and long-distance services.

The first combined run completed in about 1.7 seconds. A repeated run in the
same runtime completed in about 0.5 seconds using the 20-second in-memory
cache. Both directions were requested; 17 EVAs were sent in batches of at
most five. This confirms that the existing DB Marketplace credentials are
accepted by OpenBoards and that the API returns useful regional and S-Bahn
board data for the tested EVA numbers.

The probe is read-only with respect to Turso. It reads the active crossing
catalog and Mobilithek snapshot for comparison, but performs no database
writes. The route is under `/api/admin` and therefore protected by the
application middleware; Preview currently has its configured admin bypass.

## Mobilithek freshness finding

The same Preview probe found no Mobilithek snapshot rows in the current
five-minutes-past / three-hours-future window for the 17 tested EVAs. The
existing admin snapshot status endpoint explains why: the last successful
refresh finished at `2026-10-17T03:01:16Z`, the snapshot contains only 53
rows, and its latest event is `2026-10-17T21:12:00Z`. On 19 November this
snapshot is more than a month old.

Therefore, the zero current-window match is **not** evidence that Mobilithek
does not cover these stations; it means the stored snapshot is stale and a
current side-by-side coverage comparison cannot yet be made. The Worker code
has a `scheduled()` handler, but no cron trigger is declared in the committed
`wrangler.jsonc`; the Cloudflare dashboard schedule must be checked.

## Rate-limit note

The Marketplace plan currently documents 10 requests/second. The client spaces
requests by 125 ms (8 requests/second) **per Node.js runtime**. This is not a
distributed limiter across multiple Vercel instances. Production use must
therefore be centralized or otherwise coordinated before enabling parallel
traffic at scale.

## Important coverage limitation

OpenBoards provides arrival/departure boards at stations. A train passing a
station without stopping is not guaranteed to appear on that station's board.
The existing Mobilithek route/call snapshot remains relevant for through-train
detection until a fresh comparison proves which cases OpenBoards can cover.

## Next validation steps

1. Restore/verify the Mobilithek Worker schedule and obtain a fresh snapshot.
2. Compare OpenBoards boards against fresh Mobilithek events for the same
   observation EVAs, including cancellations, delays, operator coverage and
   through trains.
3. Normalize OpenBoards entries into the shared train model, preserving
   journey ID, operator, category, line, actual/scheduled time, origin,
   destination, via stops and platform.
4. Introduce a feature-flagged primary-stop source using OpenBoards, while
   keeping Mobilithek for through-train and uncovered-operator gaps.
5. Measure request counts, refresh latency and Turso writes before reducing
   Mobilithek subscriptions or changing production source priority.

Do not switch production source priority or disable Mobilithek before this
fresh-data comparison and staged validation.


## Write-volume guardrails (20 November 2026)

- Queue state is the source of last-run status; successful polls do not append
  one permanent `openboards_refresh_runs` row each time. The run log is
  reserved for failures.
- Observation UPSERTs compare all meaningful train fields. Identical board
  results are not rewritten on every poll; freshness metadata is refreshed at
  most once per ten minutes unless train data changes.
- Core classification uses the crossing name as well as station names, so a
  configured Kirchlengern crossing remains on the core interval even if its
  station EVA is not yet present in the optional station catalogue.
- Mobilithek demand now includes `observation_evas` as well as legacy
  `reference_stations`, ensuring newly selected observation stations also
  enter the route/call snapshot demand. This does not alter forecast matching.
