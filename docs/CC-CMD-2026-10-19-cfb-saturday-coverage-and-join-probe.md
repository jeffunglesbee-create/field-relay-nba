# Claude Code Command — the CFB backfill leaves most of every Saturday unpriced, and the join probe has no way to pass

**Date:** 2026-10-19
**Repo:** field-relay-nba (Part A, TASK A2 also touches jubilant-bassoon)
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL — approved 2026-10-29 ("cfb Saturday approved"). TASK A0 done except the job-log half of A0.2
(`outbox/cfb-saturday-a0-20261029.md`). A1 and B1 are owner options with no pick yet. A2 does not depend on either
(it changes readers, not what the backfill writes).
**Filed by:** CC, while recording the CFB done condition (Rule 87.4). Its
sibling is `docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md`, which covers
pairs that are wrong. This one covers games the backfill never prices,
after-kickoff prices read as openings, and a probe that cannot measure. An
adversarial fact-check corrected the first draft of this document before it
was committed.

---

## Part A — Saturday coverage

Measured 2026-10-19 with D1 SELECTs on field-archive (0 rows written). The
log is `outbox/cfb-wrong-pair-repro-2026-10-19.log`.

| Saturday | CFB rows | priced | unpriced | priced, captured after kickoff | unpriced, kickoff before 22:00Z |
|---|---|---|---|---|---|
| 2026-09-19 | 71 | 34 | 37 | 22 | 30 |
| 2026-09-26 | 65 | 25 | 40 | 16 | 33 |
| 2026-10-03 | 54 | 21 | 33 | 14 | 31 |
| 2026-10-10 | 46 | 15 | 31 | 11 | 30 |
| 2026-10-17 | 52 | 22 | 30 | 13 | 30 |
| **total** | **288** | **117 (41%)** | **171 (59%)** | **76** | **154** |

**What the rows show:**
- **Before 22:00Z:** 154 of the 163 rows that kicked off before 22:00Z are
  unpriced. The 9 priced ones are 8 correct pairs that kicked off 20:00-21:35Z
  and were still in play at the snapshot, plus the wrong pair in the sibling
  document.
- **10-17 is exact:** every row at or after 22:00Z is priced (22 of 22) and
  every row at or before 21:00Z is unpriced (30 of 30). 28 of the 30 are FBS
  against FBS, among them Ohio State @ Indiana, Texas vs Florida, Georgia vs
  Auburn, Tennessee vs Alabama and Michigan vs Penn State.
- **The other 17 unpriced rows** kicked off at or after 22:00Z and need
  another explanation. One is GA Southern @ Jax State, whose event the wrong
  pair took.

**The mechanism, from 0-credit evidence.**
`.github/scripts/odds-backfill.js:192` asks for ONE historical snapshot per
sport-date, at `${isoDate}T23:59:00Z` ("Closing line proxy").
- **The logs show the absence directly.** On 10-17 the response had 23
  in-pool events; all 23 were paired, and 29 games were left with no event
  (`23 in pool -> 23 paired by name, 0 by elimination, 29 unmatched`). 09-19
  reads 40 in pool, 39 paired, 32 unmatched.
- **An earlier snapshot is already shown to work, in D1.** The 2026-09-12
  Saturday was priced by `targeted-odds-fill` from a 12:00Z snapshot: 67 of
  80 rows, including 35 of the 42 that kicked off before 22:00Z.
- **"Finished by 23:59Z" is not the whole rule.** Troy @ Louisiana (kickoff
  21:00Z, finalized 00:15Z) was still in play at 23:59Z and is unpriced.

**After-kickoff "opening" prices are only half handled.** 76 of the 117
priced rows were captured after kickoff.
- **The mark:** the sync stamps the same blob, with `_kickoff.late_minutes`,
  into both `opening_odds` and `closing_odds`.
- **The closing side:** `CC-CMD-2026-09-14-closing-odds-captured-after-kickoff`
  wired its closing readers to that mark.
- **The opening side:** that document scoped itself out of `opening_odds`
  ("Do not touch `opening_odds`"). Readers that take `opening_odds` by name
  do not check the mark:
  - the debrief line `Odds: opened …` (src/index.js ~5883; its `closed` half
    beside it does check `knownPostKickoff`);
  - `buildBackfillPrompt` (~7103);
  - the slate odds line (~9090);
  - jubilant-bassoon `_isUpset` (src/legacy/field.js:11692), which has 0
    references to `_kickoff` or `late_minutes`.

**Not measured:** whether other sports lose early games the same way. The
same snapshot serves every sport the backfill handles.

### TASK A0 — premises (Rule 100), 0 credits

1. **An earlier snapshot recovers the early games.** A D1 SELECT over the
   2026-09-12 CFB rows: `captured_at`, kickoff, and priced or not. This
   repeats the 35-of-42 reading above with its query committed.
2. **Which other sports lose games.** Per sport-date since 2026-09-16, count
   unpriced archive rows by kickoff hour, against the backfill's per-sport
   `unmatched` counter (`get_job_logs`).
3. **Every `opening_odds` reader.** Grep both repos and list every reader
   with whether it checks `_kickoff`. The four above are the minimum, not the
   census.

**A0 RESULTS, 2026-10-29** (0 credits; D1 SELECT only, plus a grep of both repos; full queries and tables in
`outbox/cfb-saturday-a0-20261029.md`):

1. **A0.1.** 2026-09-12 CFB: 80 rows, 67 priced (84%), 35 of the 42 rows kicking off before 22:00Z, all from one
   capture at `11:55:36Z`, none after kickoff. The 10-19 reading reproduces.
2. **A0.2, D1 half.** Unpriced finalized rows 2026-09-16 to 10-27: CFB 203 of 383, NHL 76 of 263, NBA 69 of 123, NFL 59 of
   91. The early-kickoff loss is not CFB's alone (NFL 17Z: 40 of 47). NBA, NHL and NFL stopped losing games on 10-23
   (1 of 40, 2 of 33, 1 of 13 unpriced since); CFB's join was met on 10-28, so its 26 of 51 unpriced since 10-23
   predate it, and **2026-10-31 is the first CFB Saturday after it**. Cost of A1: (a) +30 credits per CFB date
   (125 a week), (b) +30 per kickoff window, (c) 0.
   **Open:** the backfill's per-sport `unmatched` counter in the job logs.
3. **A0.3.** Eleven readers of `opening_odds`; rows 7 and 8 pass the column through, and none of the other nine checks
   the after-kickoff mark on the opening line. The four named
   above are rows 1, 3, 4 and 9; the census adds the cron's debrief block, the odds story (two sites), and two more
   client readers. Relay half = six readers, client half = three (Rule 70).

### TASK A1 — decide the snapshot (OWNER DECISION)

- (a) a second historical snapshot per sport-date before the first kickoff;
- (b) one snapshot per kickoff window;
- (c) leave it, and record the coverage limit where the pairing watch reads.

Each extra historical call is priced by `oddsCreditCost` per sport-date. The
decision names the cost from A0.2's population.

### TASK A2 — `opening_odds` readers honour the after-kickoff mark

Every reader from A0.3 either goes through `selectLineOdds` or checks
`knownPostKickoff`.
- **Cross-repo for `_isUpset`** (Rule 70): the relay contract is unchanged,
  and the client consumer changes in the same plan.
- **Proof:** each reader gets a fixture from a real 76-row blob (for example
  `CFB_2026-09-19_e401856802`), with a mutation (Rule 90).

## Part B — the identity-join probe (CC-CMD-2026-09-11 Task 3)

Task 3's done condition:

> a fresh `/identity/mismatches?sports=CFB` on a date with rows must report
> `matched > 0` AND `unmatched` containing no pair whose two names are
> demonstrably the same game.

**As built, it cannot pass on any date:**
- **The route never got the new matcher.** The route joins on the exact key
  `${resolveTeamKey(home)}|${resolveTeamKey(away)}` (src/index.js
  ~15780-15796). The matcher built on 2026-09-16 is `matchSlate`
  (`src/odds-name-match.js`), wired only to the backfill and
  `targeted-odds-fill`, which are the two consumers
  `scripts/check-odds-matcher-wiring.mjs` lists. The route's results:
  - live, 0 of 5 on 2026-09-11 (`odds-join-probe-20260911T200950Z.json`);
  - live, 0 of 80 on the 2026-09-12 slate;
  - offline, 0 of 80 again on the 09-12 fixture (adversarial check,
    2026-10-19), where `matchSlate` gives 73 + 7.
- **The Saturday workflow probes the wrong day.**
  `.github/workflows/odds-identity-join-saturday.yml` (cron `40 23 * * 6`)
  passes no date on a schedule run, so `scripts/probe-odds-join.mjs:56` falls
  back to UTC today. Its 6 scheduled runs all started on Sunday UTC (01:24Z
  to 02:51Z, 09-13 to 10-18). The 7th run (dispatch 34667508348) was dated
  Saturday 2026-09-12 but ran at 02:23Z, before the slate was played. CFB
  reads `NO_ROWS` in all 7 artifacts, and every run concluded success.
- **The cost comment is wrong.** The workflow says "CFB only — one credit".
  The script probes `['CFB', 'NFL', 'Bundesliga', 'MLS']` (:54), and the
  relay's ledger estimate is `oddsCreditCost` 3 per `fetchSportOddsLive`
  call, so 12 per run. The provider's actual bill per run is unmeasured; the
  call is edge-cached for 900 s.

### TASK B1 — decide what Task 3 measures (OWNER DECISION)

- (a) wire `matchSlate` into `/identity/mismatches`, and add `src/index.js`
  to the matcher-wiring check;
- (b) restate Task 3 onto the backfill's own per-sport line and its D1
  result, retiring the route as its artifact.

### TASK B2 — make the Saturday probe measure, or stop it

- Pass an explicit Saturday `PROBE_DATE` on schedule runs.
- Make a CFB `NO_ROWS` print as a refusal rather than a green run.
- Correct the cost comment.
- If B1 chooses (b), remove the workflow instead and say so.

### TASK B3 — stale encodings

`.github/workflows/identity-ambiguity-watch.yml:8` and
`scripts/identity_ambiguity_conditions.py` encode CC-CMD-2026-09-11 as
"blocked until both close". Update them to B1's outcome.

## Done condition (Rule 89 artifacts)

1. **A0's three outputs are committed,** each with its denominator. (A0.1 and A0.3 and the D1 half of A0.2 are, in
   `outbox/cfb-saturday-a0-20261029.md`; the job-log half of A0.2 is not.)
2. **The owner's A1 and B1 decisions are recorded in this document.**
3. **Each code change (A2, B2) has its proof:** a fixture red before and
   green after, a mutation, and one green deploy-path run. A2 also needs a
   green jubilant-bassoon deploy.
4. **After B2, the next Saturday's artifact reads a Saturday `probe_date`,**
   and is either `matched > 0` or a printed refusal.

## FORBIDDEN

- No Odds API call without the owner's approval.
- No change to what the backfill writes until A1 is decided.
  **Owner ruling 2026-10-23 (an exception, not a decision of A1):** the
  opening-line cron, once its join matches
  (`docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`,
  shape (a)), writes CFB opening lines the same morning, before every kickoff,
  so the CI backfill fills fewer CFB `opening_odds` rows. The owner also ruled
  that the `/archive/game` closing path matches CFB, so its noon snapshot
  takes CFB `closing_odds` rows before the CI backfill's later line can. A1
  itself (the CI backfill's snapshot) stays open.
