# Brief Archive Fix — KV Sweep + Backfill Gate (2026-06-22)

## Pre-build probes

- Inline KV sweep lived at `src/index.js:4797-4848` inside the
  dead-hour branch of `runDeadHourBackfill` (gated by `if (!isLiveHours)`
  at L4727). Per-game briefs written to KV during live hours have a 1 h
  TTL — if the next dead-hour tick is more than 1 h away, those briefs
  expire before sweep.
- game_brief backfill at `src/index.js:~4868` was gated on
  `briefResult.skipped` only. Live-cron-fresh slate briefs return
  `ok:true` (skipped:false), so the per-game backfill never fired for
  recent dates. Result: zero `game_brief` rows after 2026-06-17.
- `executeGameBriefBackfill(env, date)` already dedups internally
  (checks for existing `game_brief` rows before generating), so
  re-firing on `ok:true` is idempotent — no double-cost.

## What ships

1. Extract `sweepKVBriefs(env)` to module scope at `src/index.js`
   (right after `ensureBriefsTable`). Same logic as the inline block:
   list `brief:game:*` keys (limit 50), parse JSON or raw, null-sport
   skip if a sport-tagged sibling exists, INSERT with source='kv_sweep',
   ON CONFLICT DO NOTHING. Returns `{ swept }` or null.
2. Replace the inline dead-hour block (~50 lines) with a single
   `sweepResult = await sweepKVBriefs(env)` call.
3. Wire `ctx.waitUntil(sweepKVBriefs(env).catch(...))` next to
   `ctx.waitUntil(handleJournalismCycle(env))` in `scheduled` so the
   sweep runs every `*/5` and `*/15` cron tick.
4. Fix game_brief backfill gate: `briefResult.skipped` →
   `(briefResult.skipped || briefResult.ok)`. Comment updated to
   reflect "whether pre-existing or just written".

## Behavioral contract preserved

- Sweep logic itself is byte-for-byte unchanged (the inline block was
  literally moved out + the function call wired in).
- Null-sport cleanup at L4854-4862 stays in the dead-hours branch (out
  of spec scope, only meaningful when many sweeps have run).
- `executeGameBriefBackfill` internals untouched.
- `sweepResult` is still returned in the dead-hour result object
  (same `kv_sweep: N briefs captured` reason text).

## Expected impact

- Live-cron path: `kv_sweep` source briefs appear in `briefs` within
  the same tick a per-game brief lands in KV. No more "lost to TTL"
  briefs on busy nights.
- Recent dates: `game_brief` rows start landing the next time the
  cron writes a slate brief to a new date. Backfill dedups, so the
  cost is one round per date until the per-game set is complete.

## Failure modes (silent per Rule 5)

- FIELD_JOURNALISM or ARCHIVE_DB unbound → `sweepKVBriefs` returns
  null without doing anything.
- KV list / get throw → caught inside the function's try, returns
  null.
- D1 INSERT throw → caught per-row by outer try, `swept` counter
  doesn't increment; never throws to the cron.

## Carry-forwards

1. Null-sport KV keys still need a permanent fix at the WRITE side
   (`handleJournalismCycle` writes `brief:game:{id}` without a
   sport prefix in some paths). Out of spec scope. The sweep's
   "skip when sport-tagged sibling exists" guard handles it
   correctly today.
2. Sweep limit is 50 per tick. With ~15-30 in-flight briefs per
   busy night, that's headroom. A bigger night could overflow —
   then the next tick picks up the rest. Increase if the
   `kv_sweep` source count consistently caps at 50.
