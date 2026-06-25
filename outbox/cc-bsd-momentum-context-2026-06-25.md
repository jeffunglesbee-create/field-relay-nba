# BSD Momentum Context Source — 2026-06-25

## Probes

- CC-CMD-A confirmed: `/bsd/*` routes live, `/bsd/events/live` returns
  `{count:0,events:[]}` today (no live BSD soccer right now).
- `bsd_momentum` did NOT exist in context-assembler.js before this commit.
- `soccer_xg` was the last entry in CONTEXT_SOURCES at L543.
- Export block at L592–605 listed 5 builders, not `buildBSDMomentumContext`.

## Edits (src/context-assembler.js)

**L482–525**: `buildBSDMomentumContext` function added before the
`// ── Source registry` marker.
- Reads `game.bsdEventId || game.bsdId`; returns `''` on miss.
- Fetches `/bsd/events/{id}/momentum` via `env.RELAY_BASE` fallback to the
  worker's public origin.
- Filters momentum values to those with `value != null`.
- Computes maxSwing across adjacent values to locate the shift minute.
- Computes peakHome (Math.max) and peakAway (Math.min) across the series.
- Emits `[BSD MOMENTUM]` block with up to 4 lines:
  - shift moment (only when swing ≥ 15)
  - peak home pressure (only when ≥ 30)
  - peak away pressure (only when ≤ -30)
  - current pressure with home/away/balanced classification
- Returns `''` when no condition fires (defensive minimum: header only = ''.

**L549–553**: `bsd_momentum` entry added to CONTEXT_SOURCES.
- `priority: 8` — runs after soccer_xg (7), before any future sources.
- `budget: 120` — soft cap (the assembler also has totalBudget guard).
- `sports`: all soccer leagues (`epl`, `mls`, `ucl`, `wc26`, `laliga`,
  `seriea`, `bundesliga`, `ligue1`, `soccer`) plus `atp`, `wta`.

**L611**: `buildBSDMomentumContext` added to exports block so tests/probes
can exercise it independently.

## Commit & deploy

- `7f9aaf1` feat(context): bsd_momentum context source — minute-by-minute pressure index (1 file, +48)
- Deploy: workflow 28175536275 — completed/success.

## Done conditions

- [x] `node --check src/context-assembler.js` passes
- [x] `bsd_momentum` registered in CONTEXT_SOURCES with builder, priority,
      budget, sports
- [x] `buildBSDMomentumContext` defined (1) + referenced in CONTEXT_SOURCES (1)
      + exported (1) = 3 hits
- [x] Diff scope: `src/context-assembler.js` only
- [x] Deploy green (28175536275)

## Defensive behavior

- No `bsdEventId` on game → returns `''` immediately, no fetch.
- BSD API 5xx / network error → caught, returns `''`.
- Empty momentum values → returns `''`.
- All thresholds (swing ≥ 15, peak ≥ 30 / ≤ -30) are skip-conditions, not
  filters: if none fire, returns `''` (no header-only block emitted).
- Context-assembler totalBudget cap still applies above the per-source 120 cap.

## Why this matters

ESPN's xG/possession is cumulative — it tells you who controlled overall
but not when the game shifted. The BSD momentum index is per-minute
(−100 → +100 home dominance), so the brief can say:

```
[BSD MOMENTUM]
Game shifted at 71': pressure index +12 → +78 (home dominance)
Peak home pressure: +82
Current: +65 (home)
```

vs ESPN-only:
```
xG: HOME 1.8 - 0.7 AWAY
```

The journalism model can now reference WHEN the swing happened, not just
that one side controlled the match.

## Next

CC-CMD-D (websocket) ships the live channel for the relay endpoint that
populates the BSD events list. Once that's live, the path is end-to-end:
BSD scoreboard → game.bsdEventId → buildBSDMomentumContext → prompt.

For now, this builder is registered and will silently no-op until an
incoming game object carries `bsdEventId`. No regression risk.
