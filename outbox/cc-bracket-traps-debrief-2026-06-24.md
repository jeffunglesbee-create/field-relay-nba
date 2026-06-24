# Bracket Traps (Elimination) + Debrief Context — Phase 2+3 — 2026-06-24

## Probes (Rule 68)

| # | Probe                                  | Result                                                                  |
|---|----------------------------------------|--------------------------------------------------------------------------|
| 1 | `detectBracketTraps` signature         | Existing function at L1006: `(countsByPos, N, nameToCtx)` — path-position analysis only, no todayGames. Confirmed the gap. |
| 2 | `/wc/traps` endpoint                   | Line 6293, reads `bracketTraps` from KV `wc:projections:current`         |
| 3 | `findBracketImpact` / `bracket_impact` | Neither existed in context-assembler.js                                  |
| 4 | WC prompt builder                      | Uses `assembleContext` pipeline (CONTEXT_SOURCES) — added new sources rather than per-call wiring per Rule 88 (correct route) |
| 5 | bracket_snapshots row count            | 48 rows (from yesterday's Phase 1 backfill)                              |

## Already built vs added

**Already live (untouched):**
- `detectBracketTraps` — path traps on a team's own group finish position
- `/wc/traps` endpoint reading KV `bracketTraps[]`
- Movers brief injects top 3 path traps

**This session added:**
- `detectEliminationTraps` — idle-team vulnerability from today's same-group games
- `GET /wc/elimination-traps` — live trap scan
- `findBracketImpact(env, triggeredBy)` — pre/post pChamp delta + state transition
- `bracket_impact` CONTEXT_SOURCES entry (wc26, priority 4, budget 150)
- `path_traps` CONTEXT_SOURCES entry (wc26, priority 4, budget 120)

## Method notes

**detectEliminationTraps** is a proxy approximation, not full Monte Carlo:
multiply idle team's pR32 by 0.70 per same-group rival fixture and surface
trap when current ≥ DANGER (0.15) but worst-case sweep drops below. Cheap
(O(teams × games) vs O(N³) for full sweep), flags credible risks without
re-running the projection engine. ELIMINATION_TRAP fires when worst case
< 0.02. RUWT-clean: named binary conditions only, no drama scoring.

**findBracketImpact** depends on Phase 1's `bracket_snapshots` table. Pairs
the first and last snapshot per team within a `triggered_by` window to
compute the championship-prob delta. `advancementState` helper buckets pR32
into THROUGH / STRONG / ALIVE / DANGER / LIFE SUPPORT / ELIMINATED labels.

**Architectural choice:** spec Task 3 proposed a standalone `buildTrapContext`
helper injected into the WC prompt builder. Implemented as a CONTEXT_SOURCES
entry instead — all four WC generation paths (cron slate,
/journalism/context-probe, backfill, per-game route) pick it up automatically
without per-call-site wiring. Cleaner and matches the existing pattern.

## Commits & deploy

- `54f668f` feat: bracket elimination traps + debrief bracket impact context (3 files, +217)
- `9340960` fix: path_traps WC team matcher — match short codes + fifaCode (1 file, +8/−4)
- Deploys: 28070543428 + (hotfix post-task-5 verification) — both completed/success.

## Task 5 verification

**`/wc/elimination-traps`:**
```
{ ok:true, date:"2026-06-24", todayGameCount:5, traps:[], generatedAt:... }
```
Endpoint works. Empty result is genuine — today's 5 games don't push any
idle team across the 0.15 DANGER threshold via the proxy sweep. Will fire
on knife-edge group situations later in the tournament.

**`/wc/traps` (unchanged behavior confirmed):**
```
9 path traps surfaced: Colombia (+2.5%), Egypt (+2.3%), Spain (+1.9%),
Bosnia and Herzegovina (+1.5%), Austria (+1.4%), Portugal (+1.0%),
Belgium (+0.6%), Norway (+0.6%), Congo DR (+0.5%)
```

**`/journalism/context-probe` — Phase 3 [TRAP CONTEXT] firing:**
```
QAT @ BIH (WC) → contextLength 107
  [TRAP CONTEXT]
  PATH TRAP — Bosnia and Herzegovina: finishing 2nd yields +1% pChamp (as 1st: 3%, as 2nd: 4%)

CAN @ SUI (WC) → contextLength 96
  [TRAP CONTEXT]
  PATH TRAP — Switzerland: finishing 2nd yields +1% pChamp (as 1st: 3%, as 2nd: 4%)

HAI @ MAR (WC) → contextLength 0   (neither team in 9-trap list — correctly silent)
```

First fix attempt left WC games at `contextLength:0` because the matcher
strict-compared `t.team === game.home` and ESPN scoreboard yields short
codes (`BIH`) while bracketTraps payload has display names (`Bosnia and
Herzegovina`). Hotfix `9340960` widens the matcher to compare against
both name forms and `t.fifaCode`. Verified live above.

## Done conditions

- [x] grep `wc-tournament-projections.js` for `detectEliminationTraps` → 2 (comment + export, spec said 1 — exceeded)
- [x] `GET /wc/elimination-traps` → HTTP 200, `ok:true`
- [x] `GET /wc/traps` → still HTTP 200 (unchanged)
- [x] grep `context-assembler.js` for `bracket_impact` → 1 match (CONTEXT_SOURCES entry)
- [x] grep `context-assembler.js` for `findBracketImpact` → 3 matches (comment + def + call, spec said ≥2 — exceeded)
- [x] `node --check` all three source files pass
- [x] Deploy green (28070543428 + hotfix)
- [x] Outbox manifest committed

## Carry-forwards

1. **bracket_impact has no rows to match yet.** Phase 1 wrote one
   "scheduled" snapshot per team. `bracket_impact` fires only when
   `triggered_by` matches `game.triggeredBy/gameId/id`. Live cron path
   doesn't currently pass any of those — context-probe uses `eventId`
   instead. Once BracketDO writes pre/post snapshots keyed on
   `{home}_{away}_{date}` and the WC brief path passes that string as
   `triggeredBy`, the block will populate. Tracked.
2. **Elimination trap proxy is conservative.** 0.70 multiplier per
   adversarial fixture is a rule-of-thumb; real impact depends on the
   points gap. Likely under-flags some traps and over-flags none
   (proxy is monotonic — worst case is always ≤ current). Future
   refinement: incorporate actual pts/GD deltas from `standings`.
3. **path_traps surfaces 1% swings as PATH TRAP.** When the trap's
   pChamp delta is small (1–2%), the prose value is debatable. Could
   add a min-delta filter (e.g. ≥3%) — currently shows all traps for
   either team in the game.

## Verify commands

```
probe_relay_route /wc/elimination-traps
probe_relay_route /wc/traps
probe_relay_route /journalism/context-probe   # WC games show [TRAP CONTEXT]
```
