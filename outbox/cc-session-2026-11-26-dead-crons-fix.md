# CC session 2026-11-26/27: the dead crons, fixed (Rule 67)

**Scope.** The owner's order, 2026-11-26: "Approved to fix dead crons. Rule 42". Read as: fix the three findings of the dead-cron watch rather than admit them to the baseline, and (Rule 42) stop editing static tennis name lists event by event and change the approach. Three change sets, in three repos, plus the filing of what they left.
**Branch:** main in all three repos (CLAUDE.md), no PRs.
**Status of the whole:** see the closing section. Nothing here is called SHIPPED without the artifact that proves it.

## 1. HEAD progression

| repo | from | to | what |
|---|---|---|---|
| jubilant-bassoon | 3490dccf | `1606d7a` | `nba-clutch-update.yml` and `scripts/nba-clutch-update.py` deleted (0 of 18 runs ever succeeded; superseded by the relay's `src/nba-clutch-r2.js`) |
| field-relay-nba | | `85e3ea06` | `docs/dead-cron-baseline.json` entries emptied (the watch reported the clutch entry resolved) |
| field-relay-nba | 5768ab10 | `697b6063` | 12 commits: the tennis detector, the watch's resilience, two guard fixes (below) |
| jubilant-bassoon | 1cd9c008 | `5ef50c4d` | 7 commits: the run-time Draw-tab decision, its tests, its contract entry, its session doc, the CONTRACTS.md sync |

Relay commits in order (hashes as pushed): `d6db52f2` tennis detector; `1c17cb68` and `954b0f9b` mutation-harness hardening (it credited a parser error, a hang, a wrong case and a crash with no FAIL line as catches); `5295b968` the watch retries a 5xx and reports what it could not read (UNREAD); `15008883` transport cases G44-G56; `29b54c15` a 200 whose body cannot be used is UNREAD and never retried; `d357ba7c` a listed workflow whose file is absent has its own bucket; `889c33c4` each repo's section is written as it is read; `b61d53b2` the watch sends its token only to GitHub or to this machine; `cb3db476` a hang guard and the reading no longer waits for the long harness; `e48081db` and `697b6063` two guard fixes (below).
Client commits: `a5907ad5` the Draw tab is decided from the card's rows; `32ad851b` and `4f757620` the tests the reviews found missing; `e54bdf81` comments made exact; `cecd76d2` CONTRACTS.md entry; `1efb4ea3` HANDOFF and the client session doc `outbox/cc-session-2026-11-26-tennis-draw-runtime.md`; `5ef50c4d` CONTRACTS.md synced to the relay's copy.

## 2. What was built, and why

**Tennis (the cause of the red weekly run).** `tennis-tier-ladders.yml` compared two static name lists in the client with the main-draw count the relay held for the latest season of each named event. That count moves between 0 and n inside every event's year, so no static list is right all year; the check was red on 2026-11-09 (WTA Finals), 11-16 (ATP Finals) and 11-23 (Davis Cup), a different event each week, each correct for its week. Editing the list per event is the loop Rule 42 names. The client now decides at run time, per row, from the relay's own `round_name` (`_TENNIS_MAIN_DRAW_ROUNDS`, `_tennisRowInMainDraw`, `_tennisDrawPick`); the detector now replays that picker, extracted from the DEPLOYED page text and run in `node:vm`, over four pinned days and the trailing seven, and checks the vocabulary against the relay's own draw payloads. It fails when it cannot see (refused client, unreadable pin, a trailing window read less than 5 of 7, zero checks) instead of reporting no drift.

**The watch.** One GitHub 502 on 2026-11-25 ended the run with no log. It now retries the identical GET (5xx, transport, timeout, cut-off body; never a 4xx), keeps a per-run retry budget, files what it could not read as UNREAD by name, writes each repo as it is read, validates the shape of every 200, puts a listed-but-absent workflow in its own bucket, refuses to send its token anywhere but GitHub or loopback, and the job has a 20-minute hang guard and runs the long mutation harness AFTER the log commit.

## 3. Evidence, by class (Rule 61 / 73 / 91)

**Verified here (each with the artifact):**
- Detector self-test **244/244**; the lib and detector mutants are held as cases (Rule 90). Run against a real esbuild + strip-comments build of the final client commit the picker gave 8 of 8 right picks (`scratchpad` run, the Davis Cup quarterfinal 446, an ATP Finals round-robin none, a cancelled row none, qualifiers none, a 250's R32 over a round-robin Finals).
- Watch self-test **160/160**; watch mutation harness **109 of 109 caught**, its own coverage line: `109 mutations, 77 of them (the G series) with the case(s) that must catch them named and checked` (the harness refuses to credit a crash, a parser error, a hang or the wrong case; the output was read from the run on the final tree, and the live run's harness step is in section 7).
- Client: smoke **1123/0** (main was 1088/0), `field_unit` 103/0, `field_smoke` exit 0, eslint 0 errors, sync-source and block check pass, tennis Draw-pick harness **28 of 28 caught** (1m14s).
- Gates run in clean checkouts before each push: relay Repo guards' steps (all pass except one that is not this change's, below), Workflow YAML Gate steps, `check-commit-skip-prose`; client deploy-gate's pre-bundle steps (two harness-environment artefacts, `GITHUB_OUTPUT` and `RUNNER_TEMP` unset, and the absence-collapse ratchet run by hand with `RUNNER_TEMP` set: OK).

**Found red on main and fixed because the change caused or owned them:** (a) `scripts/cc-cmd-status-check.mjs` counted the clutch CC-CMD I filed as one more than its budget (its `**Status:**` was mid-line); fixed in `e48081db`, the check now reads 331 of 331. (b) The absence-collapse ratchet read one mutant string in the mutation harness as a new `|| 0` site (3 > baseline 2); fixed in `697b6063` by assembling the string, the idiom the ratchet's own script uses.

**Red on main and NOT this change's, left alone (Rule 69):** Repo guards' "a staged claim names a verifier that exists and runs" is red since `ed506ce8` (another session's docs commit): `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md` has a `**STAGED (Rule 74), the write.**` claim with no verifier. It is that session's claim; its owner decides the verifier. While it is red, Repo guards' steps 12-43 are skipped on every push (read from run 45919615074's job steps), so the remainder of that guard is not running on main until it is fixed. The CONTRACTS.md identity check was red on the relay's last two pushes because two relay-owned sections never reached the client copy; the client's last commit copies the relay's file over, per the convention in `05f899a`.

**STAGED (Rule 74), with unblock criteria:**
1. **The live replay against the deployed client.** What: `tennis-tier-ladders.yml` run on the deployed fixed client reading `summary.clientDecisionReplay.status` `ok`, `ran` true, `harness` `[]`, coverage above 0, `clientSplitDrift` `[]`. Blocked by: the client deploy and the first dispatch (RESULT BELOW). Verify: `outbox/tennis-tier-ladders-*.json`, field `summary.clientDecisionReplay`.
2. **The four pins' card sides** (2026-11-25 Davis Cup, 2026-11-16 ATP Finals, 2026-09-07 US Open, empty day 2025-12-22) were not readable from this sandbox (the by-date card is truncated ~12 KB through the probe route). The first dispatch confirms them; a pin that does not reproduce is a harness error, by name.
3. **The watch clearing.** The watch judges a workflow on its last three COMPLETED SCHEDULED runs; a dispatch never counts. `tennis-tier-ladders.yml` is scheduled `10 5 * * 1`, so the first scheduled run on the fixed code is **Monday 2026-11-30**. Verify: that run green, then the next watch log reading `NEW 0 / carried 0 / resolved 0` for `tennis-tier-ladders.yml`. If the 11-30 run is missed or red, the next chance is 2026-12-07.
4. **The new watch, live.** A `silently-dead-crons.yml` dispatch (RESULT BELOW): UNREAD 0, the same denominators (4 repos), a "listed active, file absent" bucket naming `bsd-join-probe.yml`.

## 4. Integration state (Rule 65)

- **Relay contract:** `/bsd/tennis/matches/by-date`, `/live` and `/draw` serve each match's vendor `round_name` unchanged; a match is main draw iff `round_name` is one of seven strings and `status` is not `cancelled` (CONTRACTS.md, "Tennis main-draw `round_name` vocabulary"). Unchanged by this work; no relay `src/` change.
- **Client consumer:** `_tennisDrawPick` / `_tennisTierAllowed` in `src/legacy/field.js`; the Draw tab is offered on a day only when a card row sits in a main-draw round. Behaviour change for every tier: the tab is now hidden on qualifying and round-robin days, and a Davis Cup quarterfinal day now shows one.
- **Status:** client VERIFIED structurally and by replay; end-to-end on the deployed page STAGED (item 1 above).
- **Known mismatch:** `tennis_draw_probe.js` (client) carries a third copy of the picker; filed, with its unblock date, as item 1 of `docs/CC-CMD-2026-11-27-dead-crons-carry-forwards.md`.

## 5. Decisions made and disclosed

- I chose the run-time decision (option 1 of the CC-CMD) under "Rule 42"; the owner approved "fix dead crons. Rule 42", not that option by name.
- **Tolerance:** one unread trailing day does not fail a run; fewer than 5 of 7 read does. Chosen so one vendor fault on one date cannot hold a weekly run red for the seven days it stays in the window, and a run that read almost nothing cannot be green.
- Named events default to rank 2 and the Finals to rank 1, above 250s (rank 3), whatever their row count: an owner policy, filed as item 3.
- The client's CONTRACTS.md was replaced by the relay's copy, which also brought in two relay sections (AFL journalism, Squiggle contact) the client never had.

## 6. Carry-forwards

All five are in `docs/CC-CMD-2026-11-27-dead-crons-carry-forwards.md`, each with a probe and a done-condition artifact: the probe's third picker (dated), the client mutation harness run by nothing, the named-event weighting (owner), `bsd-join-probe.yml` listed active with no file (field-laboratory), and the breaker that was considered and not built. The relay-side clutch staleness is `docs/CC-CMD-2026-11-26-nba-clutch-r2-stale-and-dead-fallback.md`.

## 7. RESULTS (filled after the dispatches)

**Landing (all read from the runs, 2026-11-27):**
- field-relay-nba push `697b6063` (12 commits). Workflow YAML Gate run `45922249846` **success**. Repo guards run `45922249880` **failure at one step only**: "a staged claim names a verifier that exists and runs" (step 11, the other session's claim, above); steps 12-43 skipped by it; the two steps this change had broken, "No absence-collapse site appears beyond the baseline" (55) and "CC-CMD status lines are greppable and consistent" (61), are **success**. CONTRACTS.md identity check run `45922249870` was **failure** at 01:23Z (the client's copy had not landed); the client's own check, run `45922462876` on `5ef50c4d`, is **success**, which is the byte-identity proof; a relay dispatch was queued to confirm it from that side (result in HANDOFF if it differs).
- jubilant-bassoon push `5ef50c4d` (7 commits). Deploy gate run `45922462861` **success**, including "Deploy to Cloudflare Workers" and "Confirm — assert the LIVE site actually serves this deploy". The deployed bundle carries the six declarations plus two consts the detector reads (`_TENNIS_MAIN_DRAW_ROUNDS`, `_tennisRowInMainDraw`, `_tennisDrawPick`, `_tennisTierAllowed`, `_TENNIS_DRAW_TIER_RANK`, `_TENNIS_DRAW_NAMED_RANK`): that is what the next item proves.

**STAGED item 1, now VERIFIED: the live replay on the deployed client.** `tennis-tier-ladders.yml` dispatched on `main` (run `45922733341`, success; Rule 61 data and render halves). Artifact `outbox/tennis-tier-ladders-2026-11-27T01-28-24-264Z.json`, read after the run, not assumed from the green exit:
`summary.clientSplitDrift` = `[]`; `summary.clientDecisionReplay.status` = `ok`; `ran` = true; `harness` = `[]`; `violations` = `[]`.
Coverage line, verbatim: `checked 10 days, 9 with a drawable event, 9 I1 checks, 9 I2 checks; 9 had a candidate; pins reproduced 4 of 4; trailing window: 7 of 7 read; vocabulary: 7 main-draw name(s) offered, 4 outside name(s) refused; 0 day(s) and 1 draw read(s) unread; 0 card(s) truncated; skipped checks: I1 0, I2 0.` and its NOT SEEN clause (by-date rows only, so the nav link, `_tennisRevealDrawNav` and the live feed are not replayed; which event is chosen when several are drawable is not checked).
**STAGED item 2, now VERIFIED:** the four pins' card sides reproduced, 4 of 4 (2026-11-25 Davis Cup, 2026-11-16 ATP Finals, 2026-09-07 US Open, empty day 2025-12-22).
One draw read was unread: tournament 142, season 2026, HTTP 409. It is counted in the coverage line, does not fail the run, and is a different problem from this one (the draw route answering 409; an earlier reading named Antalya).

**STAGED item 4, now VERIFIED: the new watch, live.** `silently-dead-crons.yml` dispatched on `main` (run `45923006298`); log `outbox/silently-dead-crons-2026-11-27T01-33-34-681Z.log`. Read from it: UNREAD **0** workflows and **0** whole repos in every section; the same denominators as before, 4 repos, 517 workflows, 517 active, 101 judged (233 + 141 + 60 + 83); `listed active, file absent : 1` in field-laboratory, named `.github/workflows/bsd-join-probe.yml` with the 404 it got (not judged, not red); `FAILING 3 CONSECUTIVE RUNS : 1`, `.github/workflows/tennis-tier-ladders.yml` (red since 2026-11-09T13:47:07Z, latest 2026-11-23T15:51:46Z); ratchet `carried 0 / NEW 1 / resolved 0`, the NEW key being that same workflow. **The run is red, and it is meant to be:** the watch judges the last three COMPLETED SCHEDULED runs and a dispatch never counts, so the tennis key stays NEW until a scheduled run is green. Job order and timing, read from the run's steps: self-test 5 s (success) → Watch 2m17s (failure, as expected) → Commit the log 2 s (success: it ran after the failed Watch, which is what `if: always()` is for) → the 109-mutant harness 4m21s (**success**, after the commit). Whole job 6m50s, against `timeout-minutes: 20`: about 3 times today's job, so the guard is real and has room; the earlier 2m43s (run 45900264103) was before the harness grew, and the workflow comment says to re-measure when it grows again.

**STAGED item 3 is still STAGED and is the only thing between this work and done:** Monday **2026-11-30**, `tennis-tier-ladders.yml` scheduled run (`10 5 * * 1`, GitHub delays it; it has landed hours late). Verify, in this order: (1) that run's conclusion is success; (2) the next `silently-dead-crons` log reads `NEW 0 / carried 0 / resolved 0` and no `tennis-tier-ladders.yml` under FAILING. The watch's own schedule is `15 12 * * *`, which GitHub has been running between about 18:46Z and 23:48Z; the first log after the 11-30 run is the 11-30 or 12-01 one. If the 11-30 run is missed or red, the next scheduled chance is 2026-12-07, and nothing in this document would then be true to call done. A scheduled task (`trig_0163HZuDVWSHCSVX2rbWNgNy`, 2026-12-01T02:00Z) reads both and reports.

**Not done and said so:** the two other armed scheduled tasks are unchanged (the daily odds read; the CFL 2027 read, whose keep-or-delete is the owner's).

## 8. Owner decisions taken 2026-11-27 ("go with Claude's best recommendations")

Each is the recommendation filed in `docs/CC-CMD-2026-11-27-dead-crons-carry-forwards.md`, with what was read before acting:

1. **Named events vs 250s: keep.** No code change. Reasoning in the CC-CMD (item 3), labelled as reasoning.
2. **Weekly mutation harness: built and run.** `jubilant-bassoon` `61a9f8b4`; dispatch run `45925668008` success, step 52 s, log line `ran 28 mutations, caught 28 of 28 ... not caught 0; harness defects 0.` Before the push the step was shown red with a broken harness path and green on current main.
3. **`tennis_draw_probe.js`: on the day it can be proven.** Scheduled task `trig_01GRH95J5SxjppM22mQZ9dQN`, 2027-01-12T18:00Z; AO 2027 qualifying is Monday 2027-01-11 to Saturday 2027-01-16 (Melbourne Park and LTA pages, read 2026-11-27).
4. **`bsd-join-probe.yml`: leave.** Changed from "restore or disable" by what was read: workflow 396892304 created 2026-10-26, no commit on `main` touches the path, absent from both other live branches by directory listing. Inert.
5. **Watch breaker: not built.** Bounded by the retry budget and the job's timeout, now measured at 6m50s against 20 minutes.
6. **CFL 2027 read `trig_01Htpxma53smhqw9Z4z3zVWP`: kept.** Read-only, zero credits, fires 2027-06-15, bounded self-re-arm to 2027-09-15, and it carries its own stop condition.

**Not decided here, and not this session's:** the orphan STAGED claim in `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md` (UEFA rows, waiting on the owner's word for a production archive write) that keeps Repo guards red; the delegation was read as covering the five items above and the CFL read, not another session's production write.
