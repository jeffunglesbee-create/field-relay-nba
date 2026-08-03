# CC-CMD-2026-08-02-gate-weekly-r2-update-windows — Result

## Status: DONE. Deployed, real partial live evidence captured
(disclosed as partial, per the CC-CMD's own explicit allowance),
code-inspection confirms the rest.

## Deploy status correction (Rule 77 — investigated, not assumed)

The request described run `30781954383` as "completed successfully."
That's not what the run's `conclusion` field says — it's `failure`.
Investigated rather than accepting either framing: the run has 2 jobs,
`deploy` (completed, `success`) and `verify` (completed, `failure`).
The `verify` job's failure is a `git push` rejection
(`! [rejected] main -> main (fetch first)`) on its own trailing
"commit post-deploy verify note" step — a concurrent-push race with
another session, the exact same known non-blocking failure shape
already seen and documented this session for the BSD-club-gate deploy.
The actual `wrangler deploy` step lives entirely inside the `deploy`
job, which succeeded — commit `1882fac` is genuinely live.

## Task 1 — real cadence reasoning per function (already committed in
`1882fac`, restated here for closure)

- `runMLBSavantUpdate` / `runNFLR2Update` / `runNHLGSAXUpdate` /
  `runNBACluichUpdate` — all four are hour-scoped, weekly-cadence data
  drops (MLB Savant, nflverse, NHL GSAX, NBA Clutch — Clutch's own
  existing source comment says "clutch stats update daily at most").
  None has a real 5-min freshness need, unlike
  `runBSDClubLeagueEndgameCapture`'s genuine need (different CC-CMD,
  already closed). Gated to `*/15` only.
- `runNHLSeriesUpdate` — no hour restriction at all; was firing on
  literally every real tick for ~4 months, the most exposed of the
  five. NHL playoff boxscores complete once per game, not
  continuously, so gated to the existing daily `0 9 * * *` cron
  (reused, not a new cron pattern) is real enough.
- Re-confirmed no dedup/cooldown mechanism exists in any of the 5
  source files before adding the gate (the one `.get()` in
  `nhl-series-r2.js` is per-game content dedup, not an
  invocation-level cooldown).

## Task 2 — 5 gates added (already committed in `1882fac`)

`src/index.js` lines 8081-8148: `_r2ShouldFire = event.cron === '*/15
* * * *'` gates the four hour-scoped functions (lines 8087, 8091,
8127, 8146/8148); `event.cron === '0 9 * * *'` gates
`runNHLSeriesUpdate` (line 8111) via the reused daily cron. A single
`[R2-WINDOW-GATE]` log line (line 8082) logs both gate booleans on
every tick for live verification.

## Task 3 — real partial live evidence + code-inspection for the rest

Dispatched `r2-window-gate-tail-verify.yml`
(run [`30782468627`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/30782468627),
completed `success`), which tailed live worker logs across a real
6-minute window and committed the real captured lines to
`outbox/r2-window-gate-tail-20260803T034836Z.log`:

```
[R2-WINDOW-GATE] cron=*/5 * * * * r2ShouldFire=false nhlSeriesShouldFire=false
[R2-WINDOW-GATE] cron=*/15 * * * * r2ShouldFire=true nhlSeriesShouldFire=false
```

Capture window: ~03:48 UTC, Monday 2026-08-03.

**What this directly, live-observed evidence confirms (real, not
code-inspection):**
- On a real `*/5` tick, `r2ShouldFire` correctly evaluates `false` —
  the top-level cron gate for all four hour-scoped functions is
  working exactly as coded; none of them can fire on a `*/5` tick.
- On a real `*/15` tick, `r2ShouldFire` correctly evaluates `true` —
  the gate correctly *admits* the four hour-scoped functions to their
  individual date/hour window checks on the right cron.
- `nhlSeriesShouldFire` correctly evaluates `false` on both observed
  ticks — `event.cron` genuinely never equals `'0 9 * * *'` outside
  its real daily firing time, confirming that gate isn't accidentally
  wide.

**What is NOT directly observed this session (code-inspection only —
disclosed per the CC-CMD's explicit allowance, since no real window
was active during the capture)** — per function:
- `runMLBSavantUpdate`: needs `_utcDay===1 && _utcHour in [10,13]`.
  Capture was Monday (day=1 ✓) but hour≈03 (not in [10,13]) — the
  day-of-week match was real and live-observed as *not* combined with
  an hour match (correctly did not fire); the positive hour-match path
  itself is code-inspection only.
- `runNFLR2Update`: needs `_utcDay===3` — capture was day=1, so this
  function's window wasn't even day-eligible this session; entirely
  code-inspection only.
- `runNHLGSAXUpdate`: needs `_utcDay===4 && _utcHour===11` — day=1,
  not day-eligible; entirely code-inspection only.
- `runNBACluichUpdate`: needs the Finals-window/`_isMWF`/hour-12 or
  Wednesday/hour-12 branches — day=1 matches neither `_isMWF`'s
  implied days nor Wednesday; entirely code-inspection only for the
  positive-match branches (both branches read directly from
  `src/index.js` lines 8146/8148, logic unchanged from the diff
  already reviewed in Task 2).
- `runNHLSeriesUpdate`: needs `event.cron === '0 9 * * *'` — no real
  `0 9 * * *` tick landed inside the 6-minute capture window (the
  workflow's own tail window doesn't span a 9am UTC boundary at
  Monday 03:48 UTC); entirely code-inspection only, though the
  negative case (`nhlSeriesShouldFire=false` on both observed ticks)
  is real, live-observed evidence that the gate isn't falsely wide.

This is honest, disclosed partial evidence, matching the CC-CMD's own
stated allowance that no real window would be active at dispatch time.

## Outbox
This file + `outbox/r2-window-gate-tail-20260803T034836Z.log`
(committed by the tail-verify workflow itself, run `30782468627`).
