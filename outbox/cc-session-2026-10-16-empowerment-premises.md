# CC session — empowerment premise pass, and the BDB route's consumer — 2026-10-16

**For:** field-laboratory `docs/CC-CMD-2026-10-15-empowerment-metrics.md`,
Tasks 1-4. That CC-CMD is executed in field-laboratory; this repo carried two
pieces of it.

## 1. The premise pass (`scripts/empowerment-premises.mjs`, `empowerment-premises.yml`)

field-laboratory's designs for Flow, Tactical Lock and Second Wind rested on
premises read from a 150-capture sample or from one fixture. Lab Rule 100 says
to list them and run the command that would refute each before building. This
runner does that, as JSON counting only: no metric is computed here.

- **Why here.** The lab sandbox cannot reach workers.dev or the NHL APIs, and
  committing a probe in the lab costs a 60-minute confidence gate. The R2
  routes and the BSD token (for kickoff rows) are this repo's.
- **The R2 walk is copied** from field-laboratory `scripts/probe-empowerment.mjs`
  at 8eaf5a0, because that repo is private and run 38962039219 got
  "Repository not found" fetching it. Bodies compared identical after stripping
  comments; the artifact checks the copy against the source's own result (786
  captures uploaded by Task 0's census time: 786).
- **Self-test:** 29 checks, every counter driven non-zero and kept at zero on
  purpose. Deliberate breaks of the counters, in two rounds of 9 and 12:
  three survived (the thirds boundary and an unreadable END time in the first,
  a period-4 shift in the second); each was closed by a new case and then
  caught.

Runs: 38962367310 (first full pass), 38963130231 (adds goal types, shot
situations and extra-time markers). Artifact: `outbox/empowerment-premises-latest.json`.

| premise | result |
|---|---|
| xG on every shot | 20,897 of 21,020 rows; 123 null in 9 captures; **0 rows at xG 0**; 496 estimated |
| stoppage at 105' | `min` + `added` at 45 (686), 90 (777), 105 (8), 120 (13), nowhere else |
| full time before extra time | FT beside an extra-time marker in 17 captures, level in 13 |
| kickoff for every capture | `event_id` in 789 of 789 captures; `event_date` on 789 of 789 joined rows |
| own goals | `gtype` "own" on 73 rows, booked to the credited side (70 of 74) |
| shootout kicks | 8 rows, `sit` "shootout", minutes 122-129, one capture |
| a clock below the minute | `period_second` on 66 incidents only; none on shots or sequence events |
| NHL shift rows (328 games, 2025-26) | 0 unreadable, 0 reversed, 0 truncated charts; 0 skaters without a position |
| NHL late decline | **refuted**: last-third attempt rate is flat to slightly higher than first-third in every TOI band |

## 2. The BDB route's consumer

**Done 2026-10-17.** field-laboratory's Gravity Well now reads
`/nflverse/bdb_event_frames.json`: its `scripts/frames-route-check.mjs`, run by
`gravity-census.yml`, fetched the deployed route and hashed it against the
capture Gravity Well computes over (lab run 38995271211: HTTP 200, `X-Source:
r2`, 1,816,808 bytes, sha256 `6be5a282…d249` on both sides). The `STAGED`
marker came off in `62b0dce` (comment only), deployed by run 38995848911, and
the route re-verified 11/11 after it (run 38996158837, 2026-10-17T02:45:26Z).
`81d4072` re-cites this pass's header by rule tag after the owner's `3086406`.

## HEAD progression

- `b88ac64` premise pass, `2dfd4f0` carries its R2 walk, `8bc3f69` names goal
  types and markers; bot commits `88bf189`, `e09b74e` (artifacts).
