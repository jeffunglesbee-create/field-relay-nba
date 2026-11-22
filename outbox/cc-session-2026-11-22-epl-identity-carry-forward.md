# Session 2026-11-22: docs/CC-CMD-2026-09-11-epl-identity-resolve.md carried forward

Session: https://claude.ai/code/session_01CggeNbCfJwZGqP88Ttq7r2
Trigger: the owner's status question on this CC-CMD, then "Carry forward" (2026-11-22), after "The forecaster should be for laboratory".
HEAD progression: relay `bd4a6c7d` -> `966fe0c8` (the feature) -> the docs commit that carries this file. Companion work in field-laboratory, below.

## What was found before anything was built

- The CC-CMD has no `Status:` line (the 10-11 queue-reconciles CC-CMD already noted this), was never executed, and the laboratory's forecaster CC-CMD retracted its wait on it. It is now PARTIAL with a status line.
- Defect 1 was already resolved, by `7191291f` (2026-10-27), not by this CC-CMD. Premise tested by command, not by reading: a read-only SELECT of `field-archive` (34 distinct EPL names, 135 rows) through `resolveTeamKey` gives 23 keys and no unresolved spelling.
- **Defect 2's rule as written does not work.** "Reached via a CANONICAL entry = RESOLVED" calls all six wrong-sport CFB schools and both benign aliases RESOLVED, because all eight are alias hits. Measured against the resolver, not inferred (`scripts/check-team-key-substitution.mjs`, section G keeps it as a guard). Building it as written would have cleared the wrong rows this diagnostic exists to find, so it was built to the CC-CMD's stated intent with a discriminator that works. This is a deviation from the text and is said so in the CC-CMD.
- An earlier lead of mine, that `Nott Forest` was an unresolved D1 spelling, was a spelling I chose and not one D1 holds. Refuted by the same SELECT.

## What was built

| where | what |
|---|---|
| field-relay-nba `966fe0c8` | `classifySubstitution` in `src/identity-resolver.js`; `/identity/mismatches` returns `key_resolved`, `key_substituted`, `key_unchecked` and `corroborated` per entry |
| same commit, checks | `check-team-key-substitution` 59 -> 78; `check-identity-route-join` 41 -> 50 (the real worker, `outbox/fixture-cfb-2026-09-12.json`, EPL rows added, section J12) |
| same commit, mutations | 25 -> 35 in place, each red by its named assertion; 32 -> 41 on a copy |
| field-laboratory | `scripts/epl-alias-coverage-check.mjs` (Task 2), its self-test 28/28, `scripts/mutate-epl-alias-coverage.mjs` 19 of 19, a drift-sentinel step with a read-only relay checkout, a verify step, the browser guard's pin 72 -> 73 |

## Verified, and how

- The whole relay guard set was run on the commit: 237 commands from `deploy.yml` and `guards.yml`, the read-only ones in parallel and the in-place mutators serially. Six failed. Four fail identically on a clean `origin/main` worktree (`check-archive-date-keying`, `check-bsd-frame-contract` exit 3, `check-queue-partition --live`, `check-sport-canonicaliser --live`: this sandbox has no route to workers.dev). Two were not regressions: `check-provenance-stamp-stability` rewrites a manifest and failed only under the parallel run (6/6 alone); `check-empty-catches` was my extraction cutting its multi-line arguments (with `--baseline=112 --require=... --control` it holds at 112 on both trees).
- The laboratory check, end to end with its real script and the relay's real resolver, against a local stub serving recorded real names: covered, exit 0; FPL route down, NOT MEASURED, exit 1; no resolver, exit 2. With the relay's real resolver from just before `7191291f` it exits 1 on exactly `C Palace` (orphan) and `Crystal Palace` (unseen): Defect 1, reproduced by the real thing.

## STAGED, with unblock criteria (Rule 74)

The new fields on the DEPLOYED route. Blocked by the route being gated and billed. Unblocked by the scheduled Saturday probe, next 2026-11-28 23:40Z; the exact assertion, tested to fail on the 11-22 payload and pass on a correct one, is in the CC-CMD. EPL is not in that probe's sports, so the EPL case rests on the local worker run.

The laboratory check's first live run is no longer staged: drift-sentinel run 45055875318 (2026-11-22, after the laboratory landing `fca5a1c9`) printed `checked 20 of 20 league clubs against 2 feed(s): fpl 20 name(s), 0 orphan(s), 0 unseen; archive 21 name(s), 0 orphan(s), 0 unseen (109 of 135 rows since 2026-07-01)`, `resolver: .relay-src/src/identity-resolver.js @ cb3c7d1` (a commit that includes the Defect 2 change), `VERDICT: covered`. The step passed.

## Not met, named

"Re-run `/identity/mismatches` for three matchdays, payloads verbatim": billed and gated, and a standing instruction in this session forbids Odds calls. Unblock: the owner authorizes up to 9 credits, or accepts the Saturday probe. Everything Defect 1 needed from that reading was obtained from the D1 read, the census route and the resolver.

## Integration state (Rule 65)

Relay contract: `GET /identity/mismatches?date=&sports=` (gated), report gains `key_resolved`, `key_unchecked` (numbers) and per-entry `corroborated` (true, false, null); `key_substituted` is now the uncorroborated count and, for each distinct sport requested, the three add up to its old value (a sport named twice has one entry). `key_unchecked` is 0 today. Consumers: none outside this repo (searched the other three). Status: BUILT, merged and DEPLOYED, proven locally; the reading on the live route is STAGED. The first deploy (run 45044427433) failed at the absence-collapse ratchet (`field-relay-nba flagged [|| ''] 57 > baseline 56`, new site `scripts/bsd-next-goal-probe.mjs`, from another session's commit `79d9dfc8`; the last green deploy was 2026-11-21, `a6b9f866`). I did not touch that file and told its session; it removed the fallback in `a21677c`. A `workflow_dispatch` of `deploy.yml` on `a21677c` (run 45045304015) passed "Deploy gate — confirm relay is live" and "the routes this deploy touched still answer" and shipped `966fe0c8`, the only `src` change since `a6b9f866`. That log does not show the gated `/identity/mismatches` itself being probed, so the new fields are read on the Saturday probe.

## The CFL VOID window (2026-11-08 to 11-23) does not cover this change

The hold voids the calendar experiment on a commit to `handleCFLOddsProbs`, `consumeOddsCredit`, `chargeOdds` (`src/budget-helpers.js`), `reconcileOddsCredit`, the client's `fetchCFLOddsProbs`/`fetchSchedule`, or an option of the odds-charge CC-CMD (`outbox/odds-cfl-season-end-prediction-2026-10-18.md`, "What voids the experiment"). Checked by command before the deploy: `git log -L :<function>:src/index.js --since=2026-11-08` returns nothing for the three functions and nothing touches `budget-helpers.js`, with a positive control (the same search without the date limit finds `6589bc16`, `7ec2d03f` and `0e6a8947`). This change's hunks are the import line and the `/identity/mismatches` handler. Other `src/index.js` commits (golf, ESPN core) landed and deployed inside the window. Not checked: the client repo's two listed calls (this change touches no client file).

`Repo guards` was also red on `check-bsd-frame-contract` (it fails on a clean `origin/main` as well); that belongs to the BSD work and was not touched.

## The live reading is scheduled

`trig_01G11kB3mfykDMeQABCQpUAp`, one-off, 2026-11-29T08:00Z (the Saturday probe has started 01:24Z to 02:51Z on the Sunday), in a fresh session. It stores no connector tools; the main path needs only git and node, and the fallback reads the public relay repo's run list with curl.
