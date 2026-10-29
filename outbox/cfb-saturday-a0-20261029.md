# CFB Saturday CC-CMD — TASK A0 premises (0 credits), 2026-10-29

**Run:** 2026-10-29 10:10Z to 10:30Z, D1 `cc49101c` (field-archive) by SELECT only (0 rows written) and a grep of this
repository and `jubilant-bassoon` at `9b25db9a` (the checkout is from 2026-10-24). Document:
`docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md`. Owner's word on 2026-10-29: "cfb Saturday approved";
A1 and B1 are options the owner has not yet picked (see the CC-CMD's "Owner's decisions" section).

## A0.1 — an earlier snapshot recovers the early games

```sql
SELECT COUNT(*) rows_total, SUM(opening_odds IS NOT NULL) priced, SUM(opening_odds IS NULL) unpriced,
       SUM(start_time < '2026-09-12T22:00') before_22z,
       SUM(start_time < '2026-09-12T22:00' AND opening_odds IS NOT NULL) before_22z_priced,
       SUM(opening_odds IS NOT NULL AND json_extract(opening_odds,'$.captured_at') >= start_time) priced_post_kickoff,
       MIN(json_extract(opening_odds,'$.captured_at')) first_capture, MAX(...) last_capture,
       COUNT(DISTINCT json_extract(opening_odds,'$.captured_at')) distinct_captures
FROM regular_season_games WHERE sport = 'CFB' AND date = '2026-09-12'
```

| rows | priced | unpriced | before 22:00Z | of those priced | priced after kickoff | captures |
|---|---|---|---|---|---|---|
| 80 | 67 (84%) | 13 | 42 | **35 of 42** | 0 | one, `2026-09-12T11:55:36Z` |

The 10-19 reading (67 of 80, 35 of 42) reproduces. The single capture at 11:55Z priced every row from it before
kickoff; compare 10-17, 22 of 52 rows priced and 13 of those after kickoff, from the 23:59Z snapshot.

## A0.2 — which sports lose games

D1 half (the backfill's per-sport `unmatched` counter in the job logs is NOT read here: see "Open" below).
Finalized regular-season rows with a kickoff, 2026-09-16 to 2026-10-27:

| sport | rows | unpriced | unpriced, kickoff before 22:00Z | priced after kickoff | unpriced since 10-23 |
|---|---|---|---|---|---|
| CFB | 383 | **203** | 186 | 115 | **26 of 51** |
| NHL | 263 | 76 | 44 | 97 | 2 of 33 |
| NBA | 123 | 69 | 40 | 15 | 1 of 40 |
| NFL | 91 | 59 | 59 | 4 | 1 of 13 |
| MLS | 94 | 8 | 3 | 6 | not read |
| Serie A | 43 | 6 | 6 | 0 | not read |
| MLB, WNBA | 198, 51 | 0, 0 | 0, 0 | 3, 1 | not read |

Also unpriced in full, and not examined for cause here: UEFA Europa League 54 of 54, EFL Trophy 53 of 53, UEFA
Champions League 36 of 36, UEFA Europa Conference League 36 of 36; Bundesliga 31 of 36, La Liga 21 of 45, Ligue 1 14 of
36, CFL 10 of 23.

Read two ways:
- **The early-kickoff loss is not CFB's alone.** CFB kickoff hours 15Z-20Z: 181 of 185 unpriced (16Z 68 of 68, 19Z 76 of
  77); NFL 17Z: 40 of 47, 20Z: 15 of 22; NHL 17Z-21Z: 20 of 22; NBA 19Z-21Z: 3 of 4.
- **NBA, NHL and NFL stopped losing them on 2026-10-23**: 1 of 40, 2 of 33, 1 of 13 unpriced since, where the 10-23
  ruling put the opening-line cron on the shared join (done condition 4 of
  `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`, met for NBA, NHL and NFL on 10-27). CFB's join
  was met on **10-28**, so the 26 of 51 unpriced since 10-23 predate it, and the first CFB Saturday after it is
  **2026-10-31**. Nothing measured so far shows whether the opening-line cron prices CFB before kickoff.

Cost of the options, from this population (a historical call is `oddsCreditCost` = 30 per sport-date; CFB rows fall on 25
dates in the window): (a) one more snapshot per CFB sport-date is **+30 credits per CFB date**, about 25 dates in six
weeks = 750 credits, 125 a week; (b) one per kickoff window is +30 per window, three windows on a Saturday +90; (c) 0.
All three are small against a 3,800 day and the 1,800 cap of `fetchSportOddsHistorical`.

## A0.3 — every `opening_odds` reader, and whether it checks the after-kickoff mark

Mark = `_kickoff.late_minutes`, read through `knownPostKickoff` or `selectLineOdds` (`src/odds-consumer-rules.js`).

| # | reader | checks the mark on the opening line? |
|---|---|---|
| 1 | debrief line `Odds: opened …`, `src/index.js:5702` | **no** (its `closed` half does, `:5709`) |
| 2 | the cron's debrief block, same line, `src/index.js:9518` | **no** (closed half does, `:9523`) |
| 3 | `buildBackfillPrompt` `odds: opened … ML …`, `src/index.js:7072` | **no** |
| 4 | slate odds line `[ODDS: opened …]`, `src/index.js:9060-9090` | **no** |
| 5 | odds story, `src/context-assembler.js:460-476` | closing only (`:466`); opening unchecked |
| 6 | odds story view, `src/index.js:12092-12110` | closing only (`:12106`); opening unchecked |
| 7 | `/context/game` response `opening:` and `has_odds`, `src/index.js:12851, 12882` | passthrough to the client, no prose |
| 8 | `src/analytics-engine.js:822-826` | selects the column (`closing_odds, opening_odds, streams`); its use is not read here |
| 9 | client `_isUpset` `src/legacy/field.js:11726` | **no** (0 references to `_kickoff` or `late_minutes` in the file) |
| 10 | client derived stats `field.js:11780, 11811, 11835` | **no** |
| 11 | client `oddsOutcome.opening` `field.js:2507` | **no** (reads the relay's raw `opening_odds_parsed`) |

**Correction 2026-10-29 (A2 build).** Three things the census above got wrong or missed:

- **A twelfth reader.** `findGame` builds `lineMovement` (`spreadOpen`, `spreadClose`, `moved`) from the opening blob with no
  mark check. Same family as rows 1-6; fixed with them.
- **The mark to test is `late_minutes`.** `verified: false` is also written when the kickoff time could not be read, so using
  it would have blanked a line that was not late (one real MLS row in the fixture).
- **Client rows 9 and 10 are dead consumers, and row 11 has the live ones.** Probed 2026-10-29: `GET /archive/query?limit=3`
  returns rows from the `briefs` table (id, date, brief_type, sport, game_id, brief_text, model, quality_score; no odds, no
  scores), and no `/archive/upsets` route exists in the relay (`grep -a "archive/upsets" src/*.js` finds nothing; already
  recorded in `outbox/odds-american-readers-2026-10-20.md`). `_isUpset`, `_consensusFavoriteWonRate`, `_consensusOverRate`
  and `computeMarketConsensus` therefore never see an `opening_odds`, and their panels stay hidden. The client readers of the
  opening blob that run on live data are the two debrief layers fed by row 11: `buildOddsStory` (CHALK / UPSET / SWEAT / DRAW
  from the opening moneyline) and `buildOddsMovement` ("Home line opened ...") in jubilant-bassoon `src/debrief/index.ts`.
  The client half of A2 is those two; rows 9 and 10 are not edited (Rule 69, and a patch to a reader with no input cannot
  be shown to do anything).
- **Not fixed, recorded:** client `_consensusOverRate` computes `Number(g.opening_odds.total)` where `total` is an object, which
  is `NaN` (all six real blobs in `outbox/fixture-opening-odds-marks-20261029.json` give `NaN`; with no feed it never runs).
  It is a different defect from this CC-CMD's and is left alone (Rule 69).

The four the CC-CMD named are rows 1, 3, 4 and 9. The census adds 2, 5, 6, 10 and 11 (and 7 and 8, which pass data
through). The relay half (rows 1-6) is one repository; rows 9-11 are the cross-repo half (Rule 70).

## Open

- **A0.2's job-log half** (the backfill's per-sport `unmatched` counter per sport-date since 2026-09-16, from the
  `odds-backfill.yml` runs): not read. It would say, per sport, how many games the snapshot returned no event for,
  against the unpriced counts above. The D1 half already shows where the loss is; the log half decides A1's size, and
  A1 is not decided.
- **Why the UEFA competitions, the EFL Trophy and Bundesliga are unpriced** is not measured here and is outside this CC-CMD.
