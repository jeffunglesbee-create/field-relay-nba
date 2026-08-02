# CC-CMD-2026-08-02-undocumented-api-health-check — Result

## Status: DONE.

## Task 1 — re-verified real request shapes from current HEAD (not memory)

Read the actual, current routes at commit `74b4f74` HEAD before writing
anything:
- `/laliga-apim/clasificacion` (src/index.js:12571) — proxies
  `apim.laliga.com/public-service/api/v1/digitalassets/clasificacion?contentLanguage=en&countryCode=US`,
  graceful `{available:false, upstreamStatus}` on non-200, `{available:false, error}`
  on exception, both HTTP 200 (never a raw 5xx).
- `/bundesliga-bapi/resolve-dayid?season=X&date=YYYY-MM-DD` (src/index.js:14871)
  — date-mode, permanently cached per (season, date) in ARCHIVE_DB
  `bundesliga_date_cache`, only invokes Cloudflare Browser Rendering on
  a cache miss.
- `/bundesliga-bapi/broadcasts?comId=X&dayId=Y` (src/index.js:15147) —
  proxies `wapp.bapi.bundesliga.com/broadcasts/{comId}/{dayId}`, same
  graceful-failure pattern as LaLiga.
- `/d1/execute` (src/index.js:12422) — authenticated (`X-FIELD-Relay:
  field-relay-cron-2026`) D1 query proxy, `codex` table on the allowlist.
- `codex` table real schema (confirmed via existing `INSERT INTO codex`
  callers at lines 5051, 5175, 12217, 12247, 16721, not assumed):
  `(key, category, title, content, status, updated_at)`.

## Task 2 — scheduled health-check workflow

`scripts/undocumented-api-health-check.mjs` +
`.github/workflows/undocumented-api-health-check.yml`. Daily cadence
(`0 13 * * *`) — neither dependency is live-game-critical, per the
CC-CMD's own guidance, unlike jubilant-bassoon's 30-min
deploy-drift-detector.yml which guards a live-app-breaking failure mode.

Calls this relay's own routes (not the upstream APIs directly), so the
check exercises the same code path real clients hit. Bundesliga uses a
real, already-resolved (season=2025-2026, date=2026-05-09) pair from
`outbox/verify-resolve-dayid-date-mode-result.json` — confirmed cached
(`dateModeSecond.cached:true`, 127ms) — so the daily check hits the D1
cache and never triggers a new Browser Rendering session (billed per
browser-minute).

Records the real fallback-gap asymmetry explicitly, per check, not just
in a comment: LaLiga's result includes `hasFallback:true,
fallbackDescription:"client falls back to FD-sourced standings..."`;
Bundesliga's includes `hasFallback:false, fallbackDescription:"NO real
fallback exists -- if this breaks, Bundesliga broadcast enrichment
silently disables itself..."`.

On any unhealthy result, writes a real incident row
(`category:'incident'`) to the `codex` table via `/d1/execute` —
detection only, no remediation, matching jubilant-bassoon's
deploy-drift-detector.yml pattern.

## Task 3 — smoke + verify

- Real syntax check before commit (this repo's `scripts/pre-commit`
  hook runs `node -c` on staged `.js` files as its own gate; ran
  `node --check` on the new `.mjs` manually first since the hook only
  globs `.js`).
- Triggered the new workflow manually once
  (`workflow_dispatch`, run `30769699806`) — **SUCCESS**, real,
  non-fabricated result committed to
  `outbox/undocumented-api-health-check-latest.json`:
  - `laliga-apim`: `httpStatus:200, available:true, hasExpectedShape:true, healthy:true`
  - `bundesliga-bapi`: `resolveDayId.ok:true, cached:true, comId:"DFL-COM-000001",
    dayId:"DFL-DAY-004C9X", matchesKnownGoodValue:true`;
    `broadcasts.available:true`; `healthy:true`
  - `incident.incidentWritten:false` (correct — nothing to record,
    both dependencies genuinely healthy)

Both real dependencies confirmed healthy in a real, current run — this
is the done condition, not merely "workflow didn't crash."

## Explicitly out of scope (per CC-CMD, not attempted)

No automated remediation. No health checks added for any other data
source (Kali AFL, FPL, FBref, etc.) — only the two undocumented
dependencies this CC-CMD named.

## Outbox
This file.
