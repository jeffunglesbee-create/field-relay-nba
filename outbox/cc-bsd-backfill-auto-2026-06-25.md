# BSD Auto-Backfill — 2026-06-25 (CC-CMD-I)

## Probes

- Two `writeWCResult` call sites at L3024, L3026 — needed `ctx` threading.
- `env._ctx` pattern referenced at L1675 but never set anywhere → defensive
  read; falls through to `await Promise.allSettled(captures)`. Not changed.
- `handleWCAdminSeed` dispatched at L6777 → new admin route inserted right
  after for consistency.
- BSD route patterns: `/bsd/events/season/?league_id=X` (verified from
  earlier commits c727874).

## Edits (src/index.js)

**`backfillWCBsdEventIds(env, {leagueId?, since?})`** — module-level
function inserted before `writeWCResult` (L1508).
- Discovery: probes `/api/v2/events/live/`, matches BSD `home_team.name`/
  `away_team.name` against existing `wc_results` team names (normalized,
  alphanumeric-only). First WC-team match yields `league_id`.
- Fetches `/api/v2/events/season/?league_id={id}` → flat list.
- Selects pending wc_results rows (`bsd_event_id IS NULL`), optionally
  filtered by `match_date >= since`.
- Matches by normalized team name in both orientations.
- UPDATEs each matched row via `env.WC2026_DB` binding (idempotent via
  `WHERE bsd_event_id IS NULL` guard).
- Returns `{ok, league_id, season_events, pending_rows, matched, updated,
  remaining_null}` shape.

**`writeWCResult` signature** — added `ctx` parameter (L1608) and
both call sites updated at L3024, L3026 via `replace_all`.

**Auto-fire hook in `writeWCResult`** — inserted after the R2 capture
block (L1681-ish), before `recomputeGroupStandings`.
- Fires only when both `env.FIELD_JOURNALISM` (KV) and `ctx.waitUntil`
  are available — defensive degrades to no-op.
- KV gate key `bsd:backfill:done:{matchDate}` with 86400s TTL — at most
  one backfill per day.
- Gate written BEFORE the backfill call so any concurrent re-entry skips.
- Logs result line (success or error) for AI Gateway / CF dashboard
  visibility.
- Backfill failure caught + logged via `console.warn` — never throws
  back into the game-final flow (Rule 5).

**`POST /admin/wc/bsd-backfill`** — manual trigger route inserted after
the `/wc/admin/seed` dispatch (L6779).
- `Authorization: Bearer ${FIELD_MCP_SECRET}` gate, identical to other
  admin endpoints.
- Body shape: `{leagueId?: string, since?: 'YYYY-MM-DD'}`.
- Returns 200 on `ok:true`, 400 on `ok:false`.

## Commit & deploy

- `4202055` feat(bsd): auto-backfill WC bsd_event_ids — admin endpoint + writeWCResult hook (1 file, +142/−3)
- Deploy: workflow 28186564122 — completed/success.

## Done conditions

- [x] `backfillWCBsdEventIds` defined + referenced in admin endpoint + in
      writeWCResult hook (3 grep hits — function def, endpoint call,
      hook call)
- [x] `/admin/wc/bsd-backfill` route present (1 hit)
- [x] `ctx` threaded into both `writeWCResult` call sites (verified via grep)
- [x] `node --check src/index.js` passes
- [x] Deploy green (28186564122) — CI smoke + structural checks passed,
      proving the function exports + route handler bind correctly
- [x] Diff scope: `src/index.js` only
- [x] No credentials in agent context — Rule 80 compliant
- [x] Outbox manifest committed (this file, no [skip ci])

## Sandbox-side verification limits

- `mcp__FIELD_Handoff__probe_relay_route` is GET-only; the admin endpoint
  is POST-only. Direct sandbox probe returns 404 (route falls through to
  default handler) on GET — that's expected, not a failure.
- Deploy smoke (structural checks 1-6, probes A-E) all green at 28186564122
  → proves bundle compiles + binds + routes load.
- True activation test = Ecuador @ Germany game-final tonight (~22:00 UTC).
  At that moment, `writeWCResult` writes `bsd_event_id`, fires hook,
  hook checks gate (empty for `2026-06-25`), runs `backfillWCBsdEventIds`,
  logs result to AI Gateway / CF dashboard.

## Expected activation log (tonight)

Watch CF dashboard logs for line shaped like:

```
[writeWCResult] auto-backfill result: {"ok":true,"league_id":"123",
  "season_events":48,"pending_rows":N,"matched":M,"updated":M,"remaining_null":48-M}
```

If hook fires but discovery fails (e.g. BSD live cleared the game
already), expect:

```
[writeWCResult] auto-backfill result: {"ok":false,
  "error":"league_id not discoverable from live events"}
```

Manual recovery in that case: POST to `/admin/wc/bsd-backfill` with
explicit `leagueId` body once known.

## Compliance audit

- **Rule 80 (CREDENTIAL-BOUNDARY-A)**: zero credentials entered agent
  context. Admin endpoint reuses existing `FIELD_MCP_SECRET`. Discovery
  uses `BSD_API_TOKEN` resident on the worker. D1 writes via the
  `WC2026_DB` binding — no CF API token anywhere.
- **Rule 47 (RELAY-IS-DUMB / ADR-002)**: pure arithmetic + classification
  (normalize names → string compare → UPDATE on match). Zero editorial
  computation, zero drama scoring, zero watch verdicts.
- **Rule 5 (archive-failure-isolation)**: auto-fire hook wrapped in
  try/catch with `console.warn` only. Failure cannot break the game-final
  flow.
- **Rule 69 (TOUCH-ONLY-A)**: did not fix the unrelated `bsd_event_id`
  destructure bug in `handleWCAdminSeed` (L2056 + L2071). Adjacent issue,
  out of scope — flagged in CC-CMD-I draft for separate commit if desired.
- **Rule 87 (SELF-COMPLETE-A)**: probe block ran, all four tasks shipped,
  done conditions verified, outbox written. No carry-forward — activation
  tonight is a natural runtime gate, not a deferred CC session.
