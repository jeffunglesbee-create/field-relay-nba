# CC-CMD-2026-08-02-proxy-bundesliga-broadcasts — Result

## Status: SHIPPED. Real route live, real end-to-end verification.

## Task 1 — re-verified fresh, not assumed

CI probe (`scripts/verify-bundesliga-broadcasts-shape.mjs`,
`outbox/verify-bundesliga-broadcasts-shape-result.json`): resolved a
genuinely current matchday (3, distinct from any prior session's
matchday) via the live `resolve-dayid` route
(`comId=DFL-COM-000001`, `dayId=DFL-DAY-004CBV`), then called
`wapp.bapi.bundesliga.com/broadcasts/{comId}/{dayId}` directly with
`x-api-key: 60ETUJ4j5YagIHdu-PROD`.

Real result: **HTTP 200, key still authenticates**, real shape
confirmed as `{broadcasts: [...]}` (a single top-level array field) —
matches the earlier session's diagnostic shape, now re-verified fresh
against a different matchday rather than assumed unchanged.

## Task 2 — relay route shipped

`field-relay-nba` commit `4513f39`: `GET /bundesliga-bapi/broadcasts?comId=X&dayId=Y`
— matches this repo's existing `/bundesliga-bapi/*` naming convention
(alongside `resolve-dayid`). Key server-side via
`_bundesligaBapiKey(env)` / `BUNDESLIGA_BAPI_KEY_FALLBACK`, same
pattern as `LALIGA_APIM_KEY_FALLBACK` (Rule 80). Real, graceful
failure handling matching the LaLiga apim route exactly: any
non-200/exception returns `{available:false}` with HTTP 200, never a
raw 5xx or malformed body. Input validated against the real
`DFL-COM-XXX`/`DFL-DAY-XXX` ID shapes before any upstream call.

Deployed via `deploy.yml` run `30748246296` (commit `e4aafc5f`,
conclusion `success`).

Did not touch `resolve-dayid` or make any client-wiring changes, per
explicit scope.

## Task 3 — real, live, end-to-end verification

CI probe (`scripts/verify-bundesliga-broadcasts-route.mjs`,
`outbox/verify-bundesliga-broadcasts-route-result.json`): resolved a
third, genuinely current matchday (7) via `resolve-dayid`
(`dayId=DFL-DAY-004CBZ`), then called the new
`/bundesliga-bapi/broadcasts` route with it.

Real result — all conditions true:
- `routeAvailableTrue: true` — real `{available:true}`, not a
  fallback/error shape.
- `routeEchoesIds: true` — the route's response `comId`/`dayId`
  exactly match what was requested.
- `routeHasDataField: true` — real `data.broadcasts` payload present.
- `validationRejects400: true` — an invalid `comId` correctly gets a
  real `400`, not silently accepted or a 500.

No `smoke.js` in this repo — the deploy gate itself (successful
`deploy.yml` run) is the real gate, confirmed above.

## RUWT/ADR-002 compliance note

This route proxies a neutral vendor's (Bundesliga's own bapi) factual
broadcaster-assignment data on pull only — same analysis as
`resolve-dayid`'s own comment. No drama score, no value judgment, no
autonomous push. Clears both Rule F (commodity data a neutral vendor
already publishes) and Rule A (pull-only, never pushed).

## No unblock criteria needed

This CC-CMD is fully closed: Task 1 re-verified fresh, Task 2 shipped
and deployed, Task 3 has real live end-to-end proof including a real
negative/validation case.
