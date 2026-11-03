# Claude Code Command — 45 relay invocations hit the 128 MB memory limit in 30 days, and nothing says which ones

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba
**Filed:** 2026-11-03, by CC, from `outbox/cc-session-2026-11-03-worker-cpu-read.md`
**Status:** FILED, not dispatched.

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
