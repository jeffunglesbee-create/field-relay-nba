# went_to_ot 3-state null-preserve through /analytics/newspaper — 2026-07-12

## PROBE BLOCK

```
$ grep -n "wentToOT: !!g.went_to_ot" src/index.js
11534:                            wentToOT: !!g.went_to_ot,
```
Confirmed exact line and surrounding object literal (`id, sport, home, away,
homeScore, awayScore, wentToOT, wasUpset, isSeriesClinch, isElimination,
margin, finalizedAt`) match the doc's citation exactly — no drift.

## TASK 1 — Fix applied

```diff
-                            wentToOT: !!g.went_to_ot,
+                            wentToOT: g.went_to_ot == null ? null : Boolean(g.went_to_ot),
```

No default substituted. `null` (unknown/not computed) stays `null`; `0`
(confirmed not OT) becomes `false`; `1` (confirmed OT) becomes `true`.
`git diff` confirms a single-line change — sibling fields (`wasUpset`,
`isSeriesClinch`, `isElimination`, `finalizedAt`) untouched, matching the
doc's own audit that none share this bug.

## TASK 2 — Verification

`node --check src/index.js` — clean.

Deployed (`0d2bd9e`), confirmed via GitHub Actions API the "Deploy RELAY
Worker" run for that commit reached `status:completed conclusion:success`.

**All three states confirmed live**, not just 2 of 3 as the doc's own
minimum bar required — via `probe_relay_route` (sandbox has no direct
`*.workers.dev` route):

`GET /analytics/newspaper/2026-07-11` (`completed_games`):
```
"MLB_2026-07-10_tigers_phillies":                    wentToOT: false
"FIFA World Cup 2026_2026-07-10_spain_belgium":       wentToOT: null
```

`GET /analytics/newspaper/2026-07-12` (`completed_games`):
```
"FIFA World Cup 2026_2026-07-11_norway_england":       wentToOT: true
"FIFA World Cup 2026_2026-07-11_argentina_switzerland": wentToOT: true
```

**Cross-checked directly against D1**, not assumed from the curl output alone:
```sql
SELECT id, went_to_ot FROM regular_season_games
WHERE id IN ('MLB_2026-07-10_tigers_phillies','FIFA World Cup 2026_2026-07-10_spain_belgium');
-- MLB_2026-07-10_tigers_phillies: went_to_ot=0   -> response wentToOT:false  (correct)
-- FIFA World Cup 2026_2026-07-10_spain_belgium: went_to_ot=NULL -> response wentToOT:null (correct)
```
Also independently confirmed real `went_to_ot=1` rows exist in D1
(`MLB_2026-07-12_mets_redsox`, `FIFA World Cup 2026_2026-07-11_norway_england`,
`FIFA World Cup 2026_2026-07-11_argentina_switzerland`) before fetching the
`true`-state response above, so the `true` case wasn't a lucky guess —
looked up which real rows would exercise it, then fetched that exact date.

## Sibling-field audit re-confirmed

`git diff` shows only the `wentToOT` line changed.
`wasUpset`/`isSeriesClinch`/`isElimination`/`finalizedAt` in the same
object literal are byte-identical to before — no collateral change.

## DONE CONDITION

Met: `wentToOT: !!g.went_to_ot` no longer exists in `src/index.js`. All
three states (not just the 0-and-1 minimum the doc set as the honest
floor) verified live against real deployed data and cross-checked against
D1 directly.

## Confidence Score

```
+15  Probe confirmed the exact cited line before editing, zero drift
+25  Replacement is exactly the null-preserving ternary, no fallback
     default introduced
+10  node --check clean
+35  Live-verified against real /analytics/newspaper responses for all
     3 states (true/false/null), not just the 2-of-3 floor the doc set
     as acceptable -- cross-checked at least one row of each against D1
     directly, not assumed from the HTTP response alone
+15  Sibling-field audit re-confirmed via git diff -- wasUpset/
     isSeriesClinch/isElimination/finalizedAt byte-identical, untouched
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `0d2bd9e` — the fix: null-preserve `wentToOT` in `/analytics/newspaper`
- (this commit) — this outbox, written after live 3-state verification
  cross-checked against D1
