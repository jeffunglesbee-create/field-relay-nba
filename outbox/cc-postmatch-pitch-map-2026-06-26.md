# Post-Match Pitch Map — STEP 1 (relay) — 2026-06-26

## The story

Two commits to ship STEP 1 of the CC-CMD:

1. `a322a7c` added `/bsd/r2/read?key=...` route to serve R2 BSD captures.
2. `6081d3d` fixed a pre-existing silent-build-failure (`src/context-assembler.js`:
   `const sportKey` was being reassigned to `'wnba'` on L450) that was blocking
   every deploy since the WNBA-fallback code shipped.

Without `6081d3d`, `a322a7c`'s wrangler build failed with
`✘ [ERROR] Cannot assign to "sportKey" because it is a constant`, swallowed by
`continue-on-error: true` on the Deploy step. Same silent-failure pattern as
the golf incident (e8ccef1). Caught via Rule 77 — bundle grep showed
`/bsd/r2/read=0` even though `/deploy/verify match=true`. The `/deploy/verify`
endpoint is unreliable when wrangler silently fails (golf outbox documented this).

## Deploys

- a322a7c run 28236618606 — wrangler build FAILED silently (continue-on-error
  marked step success despite the esbuild error).
- 6081d3d run 28236970696 — Deploy step success. Bundle grep confirmed
  `/bsd/r2/read=1` and `let sportKey=1` post-deploy.

## Done conditions

- [x] Route added after `/bsd/r2/list` handler (L7048).
- [x] `node --check src/index.js` clean (caught after sportKey fix to
      `src/context-assembler.js`).
- [x] `npx esbuild` clean (after sportKey fix; pre-fix it threw the silent error).
- [x] Bundle verified via `workers_get_worker_code`: `/bsd/r2/read=1`,
      `let sportKey=1`, `sportKey = "wnba"` reassignment legal.
- [x] Live probe `/bsd/r2/read?key=bsd/wc26/8346/stats.json` returns 200 with
      14086-byte JSON including `shotmap[25]` with `xg`, `pos`, `gm`, `body`,
      `type`, `home`, `min` per entry — exactly the schema the client pitch
      map needs.
- [x] R2 list inventory preserved (bsd/wc26/{8341,8342,8346}/{incidents,stats}.json
      live; runBSDEndgameCapture continues to write new keys at 83'+).

## Verify command vs actual key format note

The CC-CMD probe block used `key=bsd/wc26/8346/stats` (no `.json`). R2 keys
actually carry `.json` suffix (verified via `/bsd/r2/list` probe). The route
accepts arbitrary keys starting with `bsd/`, so both spec intent and actual
behavior align — the client code in STEP 2 must construct
`bsd/wc26/${bsdEventId}/stats.json` (with suffix). Updated the STEP 2 CC-CMD
draft accordingly.

## STEP 2 — client (jubilant-bassoon) — separate CC-CMD required

The CC-CMD's STEP 2 is in `jubilant-bassoon/index.html`, which is outside this
session's repo scope (`jeffunglesbee-create/field-relay-nba` only). Per Rule 87
(SELF-COMPLETE-A): "If work is out of scope, write a second CC-CMD before
closing the first."

A self-contained STEP 2 CC-CMD has been drafted at:
`outbox/cc-postmatch-pitch-map-step2-jb.md` — covers the bottom-sheet
post-game fetch + render against the now-live `/bsd/r2/read` endpoint.

## Outstanding / observations

- `/deploy/verify` reported `runId=28236618606` (a322a7c) even after 6081d3d's
  successful deploy. The relay's deploy/verify constant appears to read from the
  bundle's built-in DEPLOY_SHA, but the displayed runId/deployedAt lag —
  unreliable per Rule 77. Bundle grep is authoritative.
- The build hardening recommendation from the golf outbox (strip
  `continue-on-error` from wrangler step OR check `steps.wrangler.outcome`)
  remains outstanding. THIRD silent failure caught the same way in two days —
  worth filing as its own CC-CMD.

## Compliance

- **Rule 5**: Route reads R2 only. No writes, no D1 impact.
- **Rule 47**: Pure passthrough — relay returns R2 bytes verbatim. No editorial
  computation.
- **Rule 69**: Touched `src/index.js` (route) + `src/context-assembler.js`
  (unblocker fix — same pattern as golf e8ccef1 — necessary because adjacent
  build error was blocking the requested change from shipping).
- **Rule 77**: Detected silent build failure via bundle grep + job log
  inspection; did not rationalize "deploy step succeeded".
- **Rule 80**: No credentials in context. Public CF MCP for bundle inspection.
- **Rule 87**: STEP 2 (out-of-scope client work) gets its own CC-CMD draft
  rather than carry-forward.
