# OpenBoards integration – staged rollout

## Current state

The repository currently uses the DB Timetables API in
`packages/db-api-client/src/officialTimetableClient.ts` and Mobilithek snapshots
for route-aware train detection. OpenBoards is added as an isolated, read-only
client. It is **not** connected to the live crossing forecast and does not
replace or disable either existing source.

## Credentials

The client accepts dedicated server-side variables:

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
- Response is returned as raw JSON for now; mapping is deliberately deferred
  until a real response has been inspected.
- EVA batching defaults to 5. The public documentation confirms an EVA array,
  but does not state its maximum size. The batch size can be changed at call
  time after testing.
- Short in-process cache: 20 seconds; duplicate in-flight calls are coalesced.
- No Turso writes, no persistent raw payload storage, no automatic retries.

## Rate-limit note

The Marketplace plan currently documents 10 requests/second. The client spaces
requests by 125 ms (8 requests/second) **per Node.js runtime**. This is not a
distributed limiter across multiple Vercel instances. Production use must
therefore be centralized or otherwise coordinated before enabling parallel
traffic at scale.

## Important coverage limitation

OpenBoards provides arrival/departure boards at stations. A train passing a
station without stopping is not guaranteed to appear on that station's board.
The existing Mobilithek route/call snapshot remains necessary until a real-data
comparison proves which through-train cases OpenBoards can cover.

## Next validation steps

1. Call both directions for a small set of active crossing observation EVAs.
2. Inspect the actual response schema and map train identity, line, category,
   origin/destination, forecast time, cancellation state and via stops.
3. Compare coverage with the Mobilithek snapshot, especially non-stopping
   through trains and S-Bahn/private operators.
4. Only then introduce a normalized shared snapshot and a feature-flagged
   forecast fallback. Do not switch production source priority before this
   comparison.
