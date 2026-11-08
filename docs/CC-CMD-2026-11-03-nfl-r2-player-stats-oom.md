# Claude Code Command — the Wednesday NFL R2 job runs out of memory on most ticks, and publishes misparsed 2024 data when it doesn't

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/nfl-r2.js`, its call at `src/index.js:9825`, `_utcDay === 3 && _utcHour >= 12`); jubilant-bassoon reads the output (`src/legacy/field.js:4575`, `NFL_QB_STATS`)
**Filed:** 2026-11-03, by CC, from `docs/CC-CMD-2026-11-03-relay-exceeded-memory.md`
**Status:** DONE 2026-11-08 for option B (owner's choice, 2026-11-08): the runner job is built and live, the Worker job is retired. Removing the Worker's cron call waits on `docs/CC-CMD-2026-11-08-retire-nfl-r2-callers.md`. Record at the end.

---

## What was measured, 2026-11-03

All of it is in `docs/CC-CMD-2026-11-03-relay-exceeded-memory.md`, "what was found". In short:

1. `runNFLR2Update` ran out of memory (128 MB) on 45 ticks of its
   Wednesday 12–15 UTC window: 45 invocations, four Wednesdays, 2026-10-07 to 10-28.
   Reproduced: a 532 MB heap peak (`scripts/nfl-r2-memory-repro.mjs`).
2. Its one live source, `player_stats/player_stats.csv` (33.4 MB), holds seasons
   1999–2024 only.
3. Its parser misreads 75,416 of 134,470 lines (the comma count differs from the
   header's), and the output claims `season: 2016`.
4. Its other two sources (`ngs_passing.csv`, `advstats_rec.csv`) answer HTTP 404.
5. Each failed tick shares its invocation with `handleCron`, `handleJournalismCycle`
   and `sweepKVBriefs`. Whether those finished before the kill is not measured.

So fixing the memory alone is not the fix. A parse that fits in 128 MB would
publish wrong columns from a season that ended two years ago.

## Holds and rulings this touches (BUILD-ON-A)

- `docs/CC-CMD-2026-08-15-ngs-passing-two-writers.md` owns the `ngs-passing` key and
  the hardcoded-year question. Nothing here decides either. Its 2026-11-03 note
  records that the Wednesday writer has not completed since at least 10-07.
- `docs/CC-CMD-2026-08-02-gate-weekly-r2-update-windows.md` set the Wednesday
  `*/15` window. Do not change cron frequencies (CLAUDE.md "What NOT to do").

## Task 0 — premises, each with the command that refutes it (Rule 100)

1. *The client still reads `player-stats.json`, and what it gets is stale.* Refute:
   read `/nflverse/player-stats.json` from a runner (the sandbox cannot reach
   workers.dev) and print `updated`, `season` and the row count. If `updated` is
   after 2026-10-07, premise 1 of the finding is wrong.
2. *nflverse publishes current-season player stats somewhere.* Refute: list the
   `nflverse/nflverse-data` release tags with the GitHub API and find one with
   2025 rows. Do not name a replacement file from memory.
3. *The Monday client pipeline (`nfl-ngs-update.yml`) already covers what the
   client needs.* Refute: read its last run and the keys it writes.

## The decision (the owner's)

| option | what | cost | risk |
|---|---|---|---|
| **A. Retire the job** | remove `runNFLR2Update`'s call; the client keeps whatever R2 holds, or reads the Monday pipeline | ~20 min | a consumer loses an update it is not getting anyway |
| **B. Move it to a runner** | a scheduled GitHub Action parses with a real CSV parser from the current nflverse source and writes R2, as `build-ngs-data.py` does for NGS | ~2 h | a second scheduled workflow; Actions minutes |
| **C. Stream inside the Worker** | parse line by line with a quote-aware parser, keeping only the target season | ~2 h | still the frozen file unless premise 2 finds a current one; still shares the `*/15` invocation |

**Recommendation: A now, B only if Task 0 premise 2 finds a current source.** A
ends the 45 memory kills and the risk to journalism the same day. B is the
correct home for a 30 MB+ parse, because it doesn't share an invocation with the
journalism cycle.

## Done condition

- `MODE=localise WORKER=field-relay-nba STATUS=exceededMemory` via
  `worker-cpu-read.yml`, read after the first Wednesday past the fix (12:00–16:00
  UTC), shows **0** buckets on that Wednesday. Earlier Wednesdays in the window
  stay as they were.
- For B or C: `node --max-old-space-size=128 scripts/nfl-r2-memory-repro.mjs <csv>`
  exits 0 against whatever source the job then reads, and the published `season`
  equals the source's real maximum season (Python `csv`, not the job's own parser).

---

## 2026-11-08 — option B, built (owner: "B")

**Correction first.** This document said the job ran out of memory "on every tick".
It did not: the runner's first live read of R2 found the Worker's own write of
**2026-11-04T12:00:23Z** (`season 2016`, 1,666 players, `source "nflverse via CF Worker"`),
so the job also completed sometimes. The windows in the localise log held 15, 4, 13
and 13 failures out of 16 ticks. When it completed, it published the misparsed table:
the client was being served `season: 2016` data until 2026-11-08T06:06Z.

| commit | what |
|---|---|
| `00c4866` | `scripts/build-nfl-player-stats.mjs` + `.github/workflows/nfl-player-stats.yml` (Wed 12:41 UTC, dispatch). Source `stats_player/stats_player_week_{year}.csv`; quote-aware parser equal to Python `csv` on both real files (8,500 and 134,470 rows, identical row hashes); `fetchPlayerStats`'s aggregation, envelope and fields kept, with `team` replacing `recent_team`. Self-test 17/17; 13/13 mutations caught. |
| `a5c8da1` | `src/nfl-r2.js` retired to a stub that writes nothing. No `src/index.js` change (VOID window). `scripts/nfl-r2-memory-repro.mjs` now loads `git show 00c4866:src/nfl-r2.js`. 229 of 230 secret-free guard commands pass on HEAD and on the change, identically. |

**Task 0, answered.** (1) R2 held the 11-04 Worker write above. (2) nflverse publishes
current data at `stats_player/stats_player_week_2026.csv` (weeks 1–9 on 2026-11-08);
`player_stats_2025.csv`/`_2026.csv` answer 404. (3) The Monday pipeline
(`nfl-ngs-update.yml`) does not write `player-stats.json`.

**Done condition, B part.** First live run (`outbox/nfl-player-stats-2026-11-08T0606.log`):
541 players, 33 QBs with 100+ attempts; R2 read back with matching sha256
`eab567cd49da9ec3`; `/nflverse/player-stats.json` serves the same bytes (HTTP 200,
`X-Source: r2`). The memory part (0 `exceededMemory` buckets on the next Wednesday)
is read on 2026-11-11 after 16:00 UTC, once the stub's deploy is live.

**Seen, not touched:** `src/mlb-savant-r2.js` uses the same naive comma split (the old
file's comment says "same as mlb-savant-r2.js"); whether its source has quoted commas
is not measured. `POST /nfl-r2-update` authorises on a client-sent `X-FIELD-Admin: 1`
header; it writes nothing now, through the stub.
