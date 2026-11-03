# CC session 2026-11-03 — Worker CPU, measured (the MoonBit / Zig question)

**HEAD:** `d5434eb` → `2d21340` (reader) → `1256099` (fix) → this doc · **Branch:** main (owner's choice, asked in session)
**No deploy:** `scripts/` and `.github/workflows/` only; `deploy.yml` filters on `src/**`, `wrangler.toml`, `workers/**`.

## Why

The owner asked whether MoonBit or Zig had a case in FIELD. The only case either
could make is CPU. Nothing in the four repos recorded a CPU measurement or a
1102, so this measured before arguing.

## What was built

| commit | what |
|---|---|
| `2d21340` | `scripts/worker-cpu-read.mjs` + dispatch-only `.github/workflows/worker-cpu-read.yml`. Cloudflare GraphQL `workersInvocationsAdaptive` per Worker per UTC day (requests by status, every `cpuTime*`/`wallTime*` quantile found by introspection) and `durableObjectsPeriodicGroups` summed `cpuTime` per DO namespace. Units printed from the schema's own field descriptions. Self-test 15/15, 7/7 mutations. |
| `1256099` | Two defects in the first version, both visible in its first log: (1) the verdict counted `exceededResources` only and called the relay clean while it carried 45 `exceededMemory`; (2) the worst-day percentile pooled statuses, so the relay's "worst CPU" was the p99 of those 45 failures. Every `exceeded*` status now counts; percentiles are kept per status. Self-test 19/19, 9/9 mutations (two of them those defects restored on purpose). |

## Runs

| run | script | log | status |
|---|---|---|---|
| 41715717689 | `2d21340` | `outbox/worker-cpu-read-2026-11-03T2047.log` | SUPERSEDED: defective verdict and pooled percentiles |
| 41716082999 | `0ddef46` (old script; dispatched before the fix landed, because the fix's push was rejected and the dispatch was sent alongside it) | `outbox/worker-cpu-read-2026-11-03T2049.log` | SUPERSEDED, same defects |
| 41716166522 | `1256099` | `outbox/worker-cpu-read-2026-11-03T2050.log` | **the result** |

## The result (30 UTC days to 2026-11-02; 5 Workers; per Worker, not per route)

All values come from `outbox/worker-cpu-read-2026-11-03T2050.log`; CPU and wall time are in microseconds per the schema.

| Worker | requests | limit hits | success CPU, worst daily p50 / p99 / p999 |
|---|---|---|---|
| field-relay-nba | 3,025,676 | **45 exceededMemory** | 2.5 ms / 41.8 ms / 372.6 ms (limit 300 s) |
| field-claude-proxy | 294,745 | 0 | 1.8 / 4.8 / 13.8 ms |
| jubilant-bassoon | 16,258 | 0 | 0.8 / 2.7 / 6.2 ms |
| field-deploy | 632 | 0 | 6.5 / 15.8 / 15.8 ms |
| stat-job-watcher (not FIELD; the `stat` repo) | 43,077 | **394 exceededResources** at 32.5 s CPU | 39 ms / 5.6 s / 8.9 s |

- **The relay has no CPU problem.** Its worst daily p999 for successful requests is 0.12% of its 300 s limit.
- **The relay has a memory problem:** 45 invocations hit the 128 MB limit, the worst day being 2026-10-07 (p50 4.7 s CPU on those 45). Cause NOT investigated.
- **Durable Objects:** AmbientDO 1,149 s and GameDO 855 s of CPU over 30 days (about 38 s and 28 s a day).
- **field-laboratory has no Worker script.** Its `wrangler.toml` has no `main` (static assets from `./public` only), so it runs no code on Cloudflare and has no Worker CPU to measure; its F# runs in the viewer's browser and in CI.

## Conclusion for MoonBit / Zig

There is no CPU case in FIELD: no FIELD Worker hit a CPU limit, and the relay's successful requests use under 0.2% of their limit at p999. The only CPU-limit hits on the account are `stat-job-watcher`'s, outside FIELD.

## Open

- **Relay exceededMemory, 45 in 30 days.** Localised and caused in the same session (Part 2 below); the CC-CMD is DONE.
- **stat-job-watcher, 394 CPU-limit hits.** A different project; reported to the owner, not filed here.

## Part 2 — the 45 memory kills, localised (owner: "localise memory")

| commit | what |
|---|---|
| `659ede9` | `MODE=localise` in the CPU reader: one Worker, one status, every minute bucket, reconciled against the daily totals (exit 3 when they differ). Self-test 27/27; 7/7 mutations after a fixture fix. |
| this push | `scripts/nfl-r2-memory-repro.mjs`; findings in `docs/CC-CMD-2026-11-03-relay-exceeded-memory.md` (DONE); fix filed as `docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md`; a dated note in `docs/CC-CMD-2026-08-15-ngs-passing-two-writers.md`. |

**Result** (`outbox/worker-cpu-read-localise-field-relay-nba-exceededMemory-2026-11-03T2057.log`, RECONCILED 45 = 45):
all 45 are on four **Wednesdays** (10-07, 10-14, 10-21, 10-28), 12:00–15:30 UTC, one per 15-minute mark. That is the
window of `runNFLR2Update`. Reproduced with the real function against the real 33.4 MB `player_stats.csv`:
532 MB heap peak; dies at a 128 MB cap; a 2,000-row cut uses 14 MB.

Also measured: the CSV stops at the 2024 season; the relay's parser misreads 75,416 of 134,470 lines; the other two
sources answer 404; the job shares its invocation with the journalism cycle (whether that finished first is not measured).

A correction made in chat: the dates were first called Tuesdays, without checking. `getUTCDay()` gives 3 (Wednesday)
for all four, which is what matches the code.
