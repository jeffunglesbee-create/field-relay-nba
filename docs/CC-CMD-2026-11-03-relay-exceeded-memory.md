# Claude Code Command — 45 relay invocations hit the 128 MB memory limit in 30 days, and nothing says which ones

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba
**Filed:** 2026-11-03, by CC, from `outbox/cc-session-2026-11-03-worker-cpu-read.md`
**Status:** DONE 2026-11-03. Localised and caused; the fix is `docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md`. Findings at the end.

---

## What was measured (Rule 73)

`outbox/worker-cpu-read-2026-11-03T2050.log` (run 41716166522; Cloudflare GraphQL
`workersInvocationsAdaptive`, 30 UTC days to 2026-11-02, sampled estimates):

- field-relay-nba: 3,025,676 requests, **45 with status `exceededMemory`**, 0 `exceededResources`.
- Those 45 have a worst daily CPU of p50 4,692,034 µs and p99 5,393,956 µs, both on 2026-10-07. Successful requests' worst daily p99 is 41,840 µs.
- A request that hits the memory limit fails outright: whatever route or cron tick it was serving gets no answer.

## What is NOT known

- **Which route, cron handler, queue consumer or DO caused them.** The dataset is per Worker.
- **Which days they fell on,** other than that 2026-10-07 had the worst percentiles. The reader keeps only each status's worst day.
- **Whether Workers Logs is on.** `wrangler.toml` has no `[observability]` block; whether logs are on by default for this Worker is unverified.

## Task 0 — premises, each with the command that refutes it (Rule 100)

1. *The 45 are concentrated on a few days.* Refute: re-run the reader's query with
   `datetimeHour` (or `date`) in `dimensions` and `status: "exceededMemory"` in the filter.
   Count the hours. If they are spread evenly, the "one bad day" story is wrong.
2. *They are cron ticks, not requests.* Refute: compare the hours against the crons
   (`*/5`, `*/15`, and the daily ones in `wrangler.toml`), and check whether introspection
   offers a dimension that separates scheduled from fetch invocations. If it doesn't,
   say so; do not infer the trigger from the timing alone.
3. *The 2026-10-07 percentiles are the same event as anything else that day.* No claim is
   made. Do not connect it to any other 2026-10-07 record without a join on time.

## Task 1 — localise

Add an hourly mode to `scripts/worker-cpu-read.mjs` (filter by one Worker and one
status, group by hour), self-tested and mutated like the rest of that file. Commit
the log through `worker-cpu-read.yml`.

## Task 2 — the cause, then a second CC-CMD for the fix

With the hours in hand, find the handler that ran at those times and read it for
unbounded growth (a whole-table D1 read, a payload held in full, an accumulating
array). The fix gets its own CC-CMD (Rule 87.4). This one ends at a named cause or
an explicit "not localisable from analytics", with the reason.

## Done condition

A committed log that lists every hour with `exceededMemory > 0` for field-relay-nba
over 30 days and sums to the total for the same window (45, or whatever the window
then holds). A list whose sum differs from the total is not done.

---

## 2026-11-03 — what was found (same session)

**Task 1, done condition met.** `outbox/worker-cpu-read-localise-field-relay-nba-exceededMemory-2026-11-03T2057.log`
(run of `659ede9`): 45 buckets at `datetimeMinute`, summing to 45, equal to the
daily totals (`RECONCILED`). The dataset offers no dimension that separates a
scheduled invocation from a fetch (its dimensions are printed in the log).

| premise | result |
|---|---|
| 1. concentrated on a few days | Yes: **four Wednesdays** (2026-10-07 15, 10-14 4, 10-21 13, 10-28 13), all 12:00–15:30 UTC |
| 2. cron ticks, not requests | One invocation per bucket, 43 of 45 on a minute divisible by 5, every one at :00/:15/:30/:45 (two at :16). Consistent with the `*/15` cron; the schema cannot confirm the trigger |
| 3. a link to other 2026-10-07 records | Not made |

**Task 2: the cause, named.** The only job gated to Wednesday 12–15 UTC on the
`*/15` cron is `runNFLR2Update` (`src/index.js:9825`, `_utcDay === 3 && _utcHour >= 12`; `src/nfl-r2.js:169`); the
other Wednesday job (NBA clutch, `src/index.js:9882`, `!_isFinalsWindow && _utcDay === 3 && _utcHour === 12`) runs at hour 12 alone, and
failures span hours 12–15. Reproduced, not inferred, with
`scripts/nfl-r2-memory-repro.mjs` (the real function, nflverse served from a local copy):

- `player_stats.csv` is **33,447,747 bytes** (content-length, 2026-11-03).
- The job peaks at **532 MB** of JS heap (36 MB before the call); with
  `--max-old-space-size=128` it dies with `JavaScript heap out of memory`. A
  2,000-row cut of the same file peaks at 14 MB and completes.

**Found on the way, each measured 2026-11-03:**

- `player_stats.csv` holds seasons **1999–2024** only (Python `csv`, 134,470 rows). No 2025 or 2026 rows.
- The relay's `parseCSV` splits on every comma. **75,416 of 134,470 data lines** have a comma count different from the header's, so their columns shift (quoted fields holding commas are the likely reason; the count is what was measured). Its output claims `season: 2016` for a file whose last season is 2024.
- `ngs_passing/ngs_passing.csv` and `pfr_advstats/advstats_rec.csv` answer **HTTP 404** (curl from the sandbox).
- The job shares its invocation with `handleCron`, `handleJournalismCycle` and `sweepKVBriefs` (`src/index.js:9773–9800`). When it runs out of memory, whichever of those is still running is killed too. Whether they had finished first is not measured.
