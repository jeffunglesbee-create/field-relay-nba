# CC-CMD-2026-09-14-collision-closing-odds-conflict

Rule 87.4: the symmetric merge closed 30 of 32 pairs and refused 2. This is the
second CC-CMD that refusal requires, not a carry-forward.

## State at HEAD

`04b16c6`. The archive holds two collision pairs whose rows each carry a real
`closing_odds` blob and the blobs differ. No fill resolves this — `COALESCE`
writes only into a NULL — and `scripts/run-symmetric-collision-merge.mjs`
refuses to apply at all while either stands.

The watch condition
(`same_slate_pair_collisions_odds_disagree`) reads **2** and will stay open
until this is decided.

## The evidence, measured 2026-09-14 via `scripts/probe-collision-odds-conflict.mjs`

Artifact: `outbox/collision-odds-conflicts-2026-09-14T13-44-22-483Z.log`

### 2026-07-25 D.C. United v Toronto

| | `2026-07-25-mls-dc-tor` | `FIFA World Cup 2026_2026-07-25_dcunited_toronto` |
|---|---|---|
| score | none | 2 - 1 |
| espn_event_id | none | 761681 |
| finalized_at | none | 2026-07-26 01:45:42 |
| source | betmgm | betmgm |
| captured_at | `2026-07-25T23:55:28Z` | `2026-07-25T23:41:27.699Z` |
| moneyline home | 100 | **-105** |
| moneyline away | 220 | 220 |
| moneyline draw | 225 | **250** |
| spread | absent | present, both null |

### 2026-08-01 D.C. United v Nashville

| | `2026-08-01-mls-dc-nsh` | `FIFA World Cup 2026_2026-08-01_dcunited_nashville` |
|---|---|---|
| score | none | 2 - 2 |
| espn_event_id | none | 761699 |
| finalized_at | none | 2026-08-02 01:45:02 |
| source | betmgm | betmgm |
| captured_at | `2026-08-01T23:55:28Z` | `2026-08-01T23:41:07.783Z` |
| moneyline home | 170 | **160** |
| moneyline away | 135 | **125** |
| moneyline draw | 210 | **250** |
| spread | absent | present, both null |

## The observation that decides it, and why this session did not act on it

The later capture is normally the better closing line — it sits nearer kickoff.
That argues for the dash-scheme rows, at 23:55:28.

**But both dash rows carry `23:55:28` to the second, on two different dates.**
The FIFA rows carry sub-second precision from two different clock readings
(`23:41:27.699`, `23:41:07.783`), which is what a real capture looks like. An
identical H:M:S across two independent captures a week apart is the signature of
a derived or defaulted timestamp, not a measurement — which removes the only
argument for preferring those rows.

That is an observation, not a verdict. This repo does not correct or invent odds
data (CLAUDE.md), and live D1 mutations are authorised case by case. So the
session stopped here rather than picking.

## Task 0 — probe, before anything is decided

Establish whether `23:55:28` is a real capture or a default. One command
answers it:

```sql
SELECT substr(json_extract(closing_odds,'$.captured_at'), 12) AS hms, COUNT(*) n
  FROM regular_season_games
 WHERE closing_odds IS NOT NULL AND id LIKE '____-__-__-%'
 GROUP BY hms ORDER BY n DESC LIMIT 10;
```

If one `hms` dominates, the dash-scheme writer stamps a constant and its
`captured_at` carries no ordering information at all.

## Task 1 — decide, on the owner's instruction only

Options, to be chosen by the owner and not by a session:

- **Keep the FIFA row's line** on both pairs and copy it over the dash row's.
  Consistent with those rows carrying the score, the ESPN anchor and
  `finalized_at`.
- **Keep the dash row's line** if Task 0 shows `23:55:28` is a genuine capture.
- **Neither** — record the disagreement and leave both, accepting that the
  condition stays open on 2.

## Done condition

`same_slate_pair_collisions_odds_disagree` reads `0` in a committed
`outbox/identity-ambiguity-watch-*.json`, with `same_slate_pair_collisions`
still `115` — the fix resolves values, it does not remove rows. Under the third
option, this CC-CMD closes instead with a committed note and the watch condition
amended to exclude the two named pairs by id.

## Scope boundary

Do not touch the 113 pairs the merge already settled or skipped. Do not delete
any row. Do not widen the fill past `opening_odds` / `closing_odds`
(`scripts/collision-cleanup-plan.mjs` records why).
