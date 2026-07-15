# CC-CMD: Fix WC26 endgame capture's dead average-positions URL — outbox

**Date:** 2026-07-15
**Doc:** docs/CC-CMD-2026-07-15-bsd-wc26-avgpos-fix.md
**Commit:** 85c6e33 (fix: apply the same live-first, stats-fallback pattern to WC26 average-positions capture)

## TASK 0 — Probe

Re-confirmed, not re-trusted, both prior findings before touching code (Rule 72):

- **Live-game test (the decisive one neither prior investigation could run):** probed `/bsd/events/live` fresh — `{"count":0,"events":[]}`. Zero live games anywhere in BSD at execution time. This is now the **third** time this exact check has come back empty (June 26 historically, July 15 earlier today, and again now) — a real, disclosed, still-irreducible gap, not a skipped step.
- **Stale-event 404 re-confirmed:** `/bsd/events/8345/average-positions` still returns 404 (same known event ID used in both prior investigations) — consistent with, not proof of, the live-only-endpoint theory.
- Read the real, current bodies of `runBSDEndgameCapture` and `_bsdCaptureStatsWithAvgPositions` directly from `src/index.js` before editing (Rule 71) — confirmed `_bsdCaptureStatsWithAvgPositions` (added by the prior dispatch's correction commit `398878d`) is already fully generic: it takes only `(bsdId, prefix, env, meta)`, nothing club-league-specific, so it's directly reusable by WC26 rather than needing a second, duplicated implementation.

No new evidence closes the live-only-vs-dead-route question definitively — that remains genuinely unresolved until a real live game is available to test against directly. The fallback design doesn't require resolving it: it's correct whichever explanation turns out to be true.

## TASK 1 — Fix

`runBSDEndgameCapture`'s per-game capture loop (`src/index.js`) changed from a flat 4-type `captureWithRetry` map (`['momentum', 'stats', 'incidents', 'average-positions']`) to: `momentum` and `incidents` unchanged via `captureWithRetry`, plus a single call to the existing, shared `_bsdCaptureStatsWithAvgPositions(bsdId, prefix, env, meta)` for `stats` + `average-positions` (dedicated-endpoint-first, stats-embedded-fallback).

**Reused the existing helper rather than duplicating it** — considered per the doc's own suggestion, and confirmed clean/low-risk: the helper has no club-league-specific state, and WC26's `bsdId`/`prefix`/`env`/`meta` shapes already match exactly what the helper expects (confirmed by inspection — `prefix` is a string R2 path prefix, `meta` is a plain object spread into `customMetadata`, identical usage pattern in both call sites).

Everything else about `runBSDEndgameCapture` is unchanged: the by-date+`league_id=27` query, the 80-120 min filter logic, the `bsd/wc26/{bsdId}` R2 key prefix, the `meta` object shape.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- **Diff review:** the entire change is confined to the one `Promise.allSettled` block inside `runBSDEndgameCapture`'s per-game loop — confirmed via `git diff`, no other lines touched. R2 key format (`bsd/wc26/...`), the by-date query, and the filter logic are byte-for-byte unchanged.
- **Forced-condition test covering both fallback branches** (no live game available — see TASK 0 — so this is a forced test, honestly labeled as such): built a Node harness running `_bsdCaptureStatsWithAvgPositions`'s real body verbatim (copied from the current source, not reimplemented) against mocked `captureWithRetry`/`fetch`/R2-put, using the real observed `/stats/` response shape (`average_positions: {home, away}`, event 8345's actual field structure). Both branches verified:
  - **Dedicated endpoint succeeds:** `average-positions.json` written once, via the dedicated call; the stats-embedded fallback path does NOT also fire (no double-write, no `source: 'stats-fallback'` marker); `stats.json` still written normally.
  - **Dedicated endpoint fails:** no dedicated write occurs; the fallback correctly extracts `average_positions` from the `/stats/` response and writes it once, tagged `source: 'stats-fallback'` for observability; `stats.json` still written normally.
  - All assertions passed.

**Deploy:** confirmed via `mcp__github__actions_get`/`get_deploy_status` — Deploy RELAY Worker (`85c6e33`): completed, success (all 33 steps, including STRUCTURAL 1-6 and PROBE A-F); Post-deploy live verification: success. Checked directly against the GitHub Actions API, not assumed from a quick status snapshot — this run took noticeably longer than the prior 3 deploys this session, and rather than assume it either succeeded or hung, pulled the actual job/step timeline to confirm real progress (e2e journalism-generation step in progress, not stuck) before waiting for the real completed/success state.

## DONE CONDITION

WC26's endgame capture now has the identical 2-level average-positions fallback as the club-league function, reusing the same helper rather than duplicating it — no longer betting entirely on one untested-live theory. Verified via a fresh live-game check (still unavailable, honestly disclosed, not the third silent skip) and a forced-condition test proving both fallback branches behave correctly against the real observed BSD response shape. `momentum`, `incidents`, `stats`, and the `bsd/wc26/...` R2 key format are all confirmed unaffected via direct diff.

## Confidence scoring (per doc's own rubric)

- **TASK 0 (30 pts):** re-confirmed both findings live rather than citing either prior version of this doc; actively attempted the one decisive test (a genuinely live game) that neither prior investigation could run — still unavailable, disclosed honestly as a real, ongoing gap rather than silently dropped. **28/30** (full marks aren't claimed because the central question — is the dedicated endpoint genuinely live-gated, or just dead — remains empirically unresolved for the third time; the fallback design correctly doesn't depend on resolving it, but TASK 0 itself didn't produce new decisive evidence beyond re-confirming the status quo).
- **TASK 1 (40 pts):** fallback applied correctly by reusing the existing, already-correct helper (not duplicating logic, not reinventing it); scoped to exactly the one capture-type block; every other part of `runBSDEndgameCapture` (query, filter, R2 key format, meta shape) confirmed untouched via diff. **40/40.**
- **TASK 2 (30 pts):** real forced-condition test exercises the actual shipped code (verbatim body, not a reimplementation) against the real observed `/stats/` shape, covering both fallback branches explicitly including the no-double-write assertion; non-regression of the other 3 capture types and the R2 key format confirmed via direct diff, not claim. **30/30.**

**Total: 98/100.**

Meets the 95 commit threshold. Committing this outbox manifest with `[skip ci]`, per the dispatch's own instruction. The real fix commit deploys normally (not `[skip ci]`).
