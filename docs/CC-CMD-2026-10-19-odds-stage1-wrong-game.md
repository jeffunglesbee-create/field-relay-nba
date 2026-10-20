# Claude Code Command — stage 1 pairs an MLB game with the same teams' next game

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** DISPATCHED 2026-10-20. TASKs 0-2 done; see Results. Rulings: TASK 1 (c) both (2026-10-19), claim check "only the far twin" and TASK 2 repair approved (2026-10-20).
**Filed by:** CC, from the TASK 0 census of
`docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md` (Rule 87.4). That document
asked whether stage 2 is the only path to a wrong pair. It is not.

---

## What was measured (2026-10-19)

Method: `node scripts/census-odds-pairs.mjs` over
`outbox/fixture-odds-pairs-2026-10-19.json` (776 odds_history rows since
2026-09-16 10:42Z), then D1 SELECTs on the rows it named (0 rows written).

**17 MLB pairs have both team names right and a kickoff 121 to 1740 minutes
away.** Stage 1 pairs on names alone, and a team pair repeats through a series.
The backfill reads one snapshot at 23:59Z, after most of the day's games have
started, so the payload no longer lists the day's game, but it does list the
same two teams' next game.

| class | rows | gaps (min) | example |
|---|---|---|---|
| next day of a series | 12 | 1141 to 1740 | `MLB_2026-09-29_e401907965` Phillies @ Braves took the 09-30 event, 1440 |
| same day, doubleheader | 3 | 206 to 301 | `MLB_2026-09-25_e401817088` and `_e401817073`, Orioles @ Yankees, both on the 23:31Z event |
| same day, start moved (likely) | 2 | 121, 235 | `MLB_2026-09-26_e401817097`, prices 18 / 1.01, captured in play |

**One event, two games.** Stage 1 decides each row against the whole pool, so
nothing stops two archive rows from taking one event. 4 MLB events are stored
against 2 games each. The other 42 shared events in the census are MLS, the
known duplicate archive rows under two id schemes (HANDOFF 2026-09-03). Both of
those duplicates get the right price.

**What reached the game tables.** In 5 of the 17 games, the sync wrote the wrong
row into `closing_odds` (`captured_at` equal to the row's `snapshot_time`):
- `e401817001`, `e401817002`, `e401817004`, `e401907992`, the next-day class;
- `e401817035`, whose `finalized_at` is NULL (a postponement, unverified).

The other 12 games were filled by other writers first.

**The distribution a threshold would need.**
- Correct pairs measured so far reach −130 minutes (CFB Clemson @ LSU).
- The next-day class starts at +1141.
- Doubleheaders and moved starts sit between them, at +121 to +301.

## TASK 0 — premises, one command each (Rule 100)

1. **All sports, not just MLB.** The census covers 2026-09-16 to 10-19. Rerun it
   after the next 7 days of backfill, and list every both-sides pair with a gap
   over 90 minutes.
2. **The postponement.** For `e401817035`, check whether an ESPN makeup id
   (`e401923610` is a candidate) is the same fixture.
3. **Every both-sides pair whose gap is between 90 and 720 minutes,** classed as
   doubleheader, moved start, or neither, by its archive twin and its
   `finalized_at`.

## TASK 1 — refuse the wrong game (OWNER RULING FIRST)

This reverses a standing ruling in `src/odds-name-match.js`'s header: "THE
KICKOFF INSTANT IS NOT A KEY … never as a filter". Options for the owner:
- (a) **Refuse when the gap exceeds N.** N comes from TASK 0. On today's data, 12
  hours separates every correct pair (≤ 130 min) from every next-day pair
  (≥ 1141).
- (b) **Claim check in stage 1.** One event may pair with one game only;
  otherwise both are refused. This handles the doubleheaders without any
  kickoff, but not the next-day class.
- (c) Both.

**OWNER RULING, 2026-10-19: (c) both.** The owner chose this in answer to "allow
a kickoff check, a claim check, or both". That question was put right after
the stage-2 session, which named two gaps: this document's stage-1 classes, and
the ~5% of wrong-team names that still pass stage 2's name rule.
- **What the ruling means:**
  - **Kickoff:** the standing "THE KICKOFF INSTANT IS NOT A KEY" ruling in
    `src/odds-name-match.js` is reversed, for a refusal only. A pair whose
    `|commence_time − start_time|` exceeds N is refused, never re-paired by
    time. N comes from TASK 0's measured distribution, not from this text.
  - **Claim check:** stage 1 lets one event pair with one game at most;
    otherwise every row claiming it is refused.
- **Read as module-wide.** The refusal sits in `matchSlate`, so it covers
  stage-2 pairs too. That is the reading recorded here, because the question
  named both gaps. If the owner meant stage 1 only, this line is what to
  correct.
- **A row with no kickoff is not refused for lacking one.** The census has 50
  rows with no archive `start_time`. The check needs both instants, and a
  missing one is counted and printed (Rule 91), not treated as a pass or a
  fail.

Proof: real fixtures from the census, red before and green after. Rule 90
mutations. Every existing case in `scripts/check-odds-matcher.mjs` stays as it is.

## TASK 2 — repair (OWNER DECISION)

The 5 `closing_odds` blobs above and the 17 odds_history rows, by the same
pattern as `scripts/repair-odds-wrong-pairs.mjs`: guarded on the blob having been
written from the row, with a `change_log` row each.

## Done condition (Rule 89 artifacts)

1. TASK 0's outputs are committed, each with its denominator.
2. Fixtures red before and green after, plus mutations, in a committed log.
3. After TASK 2, a D1 SELECT on each repaired id. Committed.
4. One green deploy-path run.

## FORBIDDEN

- No change to the kickoff ruling without the owner.
- No D1 write before the owner rules on TASK 2.
- No Odds API spend.

---

## OWNER RULINGS, 2026-10-20 (AskUserQuestion, before any code)

- **Claim check: "Only the far twin".** On a shared event, a game whose known
  kickoff is more than 90 min off is refused, and the others keep the pair
  they already had.
  - **This replaces option (b)'s literal "otherwise both are refused".** That
    reading would have unpriced the 86 MLS duplicate rows and the 3 correct
    doubleheader games, and the owner chose not to.
- **TASK 2: "NULL 5 blobs, delete 15 rows".**

## Results (2026-10-20, CC)

**TASK 0.**
- **0.1, all sports, 776 rows:** the both-sides pairs more than 90 min off
  are:
  - MLB: 12 next-day (1141-1740), 3 doubleheader twins (206-301), 2 moved
    starts (+121, +235, the right game);
  - CFB: 1 right pair at −130.

  No other sport has one. Past 720 min there are 22 rows: these 12 plus the
  10 stage-2 rows the name rule already refuses. The 7-day rerun the task
  named is replaced by a standing reading: every backfill and fill line now
  prints `kickoff too far`, `shared event's far twin` and `kickoff judged on N
  of M pairs`.
- **0.2, the postponement.** ESPN reports `401817035` as Postponed and
  `401923610` as Final (BAL 4 TOR 2, the 09-23 17:35 makeup).
  - `e401817035`'s history row priced the makeup's event. That was a price on
    a game never played on its own date, so it is in the TASK 2 set.
  - `e401923610`'s history row took the regular 22:35 game's event, its
    doubleheader twin, so it is in the set too.
- **0.3, gaps between 90 and 720 min:**
  - doubleheader twins: `e401923610` / `e401817050` (301 vs 1),
    `e401817088` / `e401817073` (206 vs 1), `e401817104` / `e401817074`
    (271 vs 6);
  - moved or delayed starts on the right game: `e401817097` (+121,
    finalized 01:15) and `e401817019` (+235, finalized 01:00 the next day);
  - neither: Clemson @ LSU (−130).

**TASK 1, ruled (c) with "only the far twin".** Shipped in `95760ec4` and
`f7b5d2dd`.
- **The rules:**
  - a pair more than 720 min off is refused in both stages;
  - on an event claimed by 2+ games, counted before any refusal, a game more
    than 90 min off is refused;
  - a missing kickoff refuses nothing and is counted as `unjudgedKickoff`;
  - a refused game is never sent to elimination, and its event stays
    claimed.
- **Real rows, `check-odds-matcher` section I:**
  - 12 of 12 next-day games refused;
  - 3 of 3 doubleheaders keep the near game;
  - 42 of 42 MLS duplicate groups stay priced;
  - the right pairs at −130, +121 and +235 keep theirs;
  - 50 of 776 rows are unjudged.
- **Mutations:** M58-M76, 76 of 76 caught.
- **Wiring:** the targeted fill selects `start_time`. The backfill's games come
  from `/context/date`, which carries it (probed 2026-10-20 through the relay
  self-probe).
- **Before the push,** a four-lens adversarial review (18 agents) confirmed 11
  findings, all fixed in `f7b5d2dd`. One was a blocker: a SQL comment ("far from
  the") would have made the relay's `/d1/execute` guard refuse the fill's games
  query with a 403.

**TASK 2, approved.** `scripts/repair-odds-wrong-pairs.mjs --set=stage1`
(`d6359a71`).
- **The dry-run preview** (D1 SELECT, 2026-10-20) shows 30 of 30 rows. The
  sync wrote exactly 5 columns from the wrong rows, the closing_odds of
  `e401817001`, `002`, `004`, `035` and `907992`.
- **The apply and its verify read** are in
  `outbox/cc-session-2026-10-20-stage1-wrong-game.md`.

