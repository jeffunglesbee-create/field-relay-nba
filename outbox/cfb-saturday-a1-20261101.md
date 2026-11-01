# CFB Saturday CC-CMD — the A1 reading, the probe artifact, and the job-log half of A0.2 (2026-11-01)

**Run:** 2026-11-01 04:30Z to 05:30Z, the wake of `docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md`. D1 `cc49101c`
(field-archive) by SELECT only (`rows_written 0`), the committed probe artifact, and the REST API for run logs. 0 Odds API credits;
no probe workflow was dispatched.

## A1 — the reading (owner's 2026-10-29 hold: "read 2026-10-31")

```sql
SELECT COUNT(*) rows_total, SUM(opening_odds IS NOT NULL) priced, SUM(opening_odds IS NULL) unpriced,
  SUM(opening_odds IS NOT NULL AND json_extract(opening_odds,'$._kickoff.late_minutes') IS NULL
      AND json_extract(opening_odds,'$.captured_at') < start_time) priced_before_kickoff,
  SUM(opening_odds IS NOT NULL AND json_extract(opening_odds,'$._kickoff.late_minutes') IS NOT NULL) marked_late,
  SUM(opening_odds IS NOT NULL AND json_extract(opening_odds,'$.captured_at') >= start_time) priced_post_kickoff,
  SUM(start_time < '2026-10-31T22:00') before_22z,
  SUM(start_time < '2026-10-31T22:00' AND opening_odds IS NOT NULL) before_22z_priced,
  SUM(start_time < '2026-10-31T22:00' AND opening_odds IS NOT NULL
      AND json_extract(opening_odds,'$._kickoff.late_minutes') IS NULL
      AND json_extract(opening_odds,'$.captured_at') < start_time) before_22z_priced_before_kickoff,
  SUM(start_time < '2026-10-31T22:00' AND opening_odds IS NULL) before_22z_unpriced,
  MIN(json_extract(opening_odds,'$.captured_at')) first_capture, MAX(json_extract(opening_odds,'$.captured_at')) last_capture,
  COUNT(DISTINCT json_extract(opening_odds,'$.captured_at')) distinct_captures, MIN(start_time) first_kick, MAX(start_time) last_kick
FROM regular_season_games WHERE sport = 'CFB' AND date = '2026-10-31'
```

| | 2026-09-12 (A0.1, before the join was met) | **2026-10-31** (first CFB Saturday after it) |
|---|---|---|
| rows | 80 | **47** |
| priced | 67 (84%) | **45 (96%)** |
| kicking off before 22:00Z | 42 | **33** |
| of those priced | 35 (83%) | **32 (97%)** |
| of those priced before kickoff | 35 | **32** |
| priced after kickoff / marked late | 0 / 0 | **0 / 0** |
| captures | one, 11:55:36Z | **one, 2026-10-31T10:01:37.867Z** |

Unpriced, both finalized, neither has a closing line: `CFB_2026-10-31_e401871059` Liberty vs FIU (19:30Z, one of the 33 early rows) and
`CFB_2026-10-31_e401869846` GA Southern vs App State (22:30Z). **Why these two is not read**: it needs the vendor's listing for
them, which costs Odds API credits and has no approval. The probe's `d1_key` for the first is `newyorkliberty|fiu`, but that is the
alias table's readout (`key_substituted`, demoted by `docs/CC-CMD-2026-09-13-team-key-sport-blind.md`), not the join's behaviour,
which is sport-aware; the key does not explain the gap.

**Reading.** CFB did not lose its early games on the first Saturday after the join: 32 of 33 priced before kickoff, where A0.1 had
35 of 42. Per the 2026-10-29 decision there is no number to put back to the owner for A1 (a) or (b). One Saturday is the sample
(47 rows); the 2 unpriced rows are unexplained.

## The scheduled probe artifact (done condition 4)

`outbox/odds-join-probe-20261101T023329Z.json` (commit `a3372d1`), written by the scheduled run 41265675536 (2026-11-01T02:33:13Z,
head `48dbddd`, **success**): `probe_date` **2026-10-31** (the run was created on 2026-11-01, so a date taken from the run's own day would
have been the 1st; the Saturday is what B2's explicit date gives), `http 200` (the secret was used), `failed []`, `error null`.

| sport | d1_rows | d1_priced | priced late | missing | vendor events (in window) | verdict |
|---|---|---|---|---|---|---|
| CFB | 47 | 45 | 0 | 2 | 23 (12) | `NO_JOIN_EVIDENCE`: 2 unpriced rows, all finished, 45 of 47 already priced (0 after kickoff), slate matcher 0 |
| NFL | 0 | | | | 11 | `NO_ROWS_AT_ALL` (the archive holds no NFL rows on 10-31) |
| Bundesliga | 6 | 5 | 0 | 1 | | `NO_JOIN_EVIDENCE`, 5 of 6 priced |
| MLS | 24 | 23 | 0 | 1 | | `NO_JOIN_EVIDENCE`, 23 of 24 priced |

`matched 0` of `probed 4` is the redefined B1(a) working as designed: with the cron pricing the morning's rows, the unpriced rows are
all finished, so the live feed cannot say whether the join solves them. The artifact agrees with the D1 reading above on every CFB
count (47, 45, 2).

## A0.2, the job-log half (the "Open" item of `outbox/cfb-saturday-a0-20261029.md`)

Every successful run of `odds-backfill.yml` created 2026-09-16 to 2026-10-31: **46 runs, 296 sport-date lines, 0 unreadable**
(`outbox/odds-backfill-unmatched-20261101.json`). `unmatched` is `odds-name-match.js` `rows.length - byGameId.size`: archive rows the
matcher found no vendor event for. **It is not the number of unpriced rows**: MLB has 101 unmatched here and 0 unpriced in D1, because
the opening-line cron priced those rows first.

| sport | sport-dates | in pool | paired | unmatched | D1 unpriced (A0.2) |
|---|---|---|---|---|---|
| CFB | 28 | 567 | 202 | **188** | 203 of 383 |
| MLS | 28 | 109 | 153 | 140 | 8 of 94 |
| MLB | 37 | 247 | 116 | 101 | 0 of 198 |
| NHL | 40 | 330 | 207 | 76 | 76 of 263 |
| NBA | 25 | 102 | 78 | 70 | 69 of 123 |
| NFL | 19 | 23 | 23 | 69 | 59 of 91 |
| Serie A, La Liga, EPL, Ligue 1, Bundesliga, UCL, EFL Cup | 85 | | 0 | 271 | listed in A0.2 |
| WNBA, CFL | 34 | | 53 | 31 | 0 of 51; CFL 10 of 23 |

Read: for NHL (76 = 76), NBA (70 against 69) and CFB (188 against 203) the counter lands within 15 of D1's unpriced count; for NFL it
is 10 above (69 against 59); for MLB and MLS it counts rows already priced. Since game-date 2026-10-23: CFB 26 unmatched (all on
10-24), NHL 5, NBA 2, NFL 11 (NFL pools of 3 events). The backfill run that processes 2026-10-31 is the one on 2026-11-01 about 15:30Z;
its `americanfootball_ncaaf` line is the next CFB reading (expect `unmatched` near the 2 unpriced rows above).
