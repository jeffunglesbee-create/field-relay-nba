# Claude Code Command — Preserve went_to_ot's 3-state null through /analytics/newspaper serialization

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Scope:** One-line fix. `went_to_ot` was deliberately designed as a 3-state column
(`INTEGER DEFAULT NULL` — 1/0/null meaning yes/no/unknown) per the original wiring
CC-CMD's own explicit design note: "NULL (not 0) is the correct default — it must
mean 'unknown/not computed,' distinct from 0 = 'confirmed did not go to OT.'" The
`/analytics/newspaper` response-builder discards that distinction with
`wentToOT: !!g.went_to_ot`, which maps both `0` and `null` to `false` before the
value ever leaves the relay — silently erasing the exact information the original
design work was built to preserve.

Audited the 4 sibling fields built in the same object literal (`wasUpset`,
`isSeriesClinch`, `isElimination`, `finalizedAt`) — none have the same bug.
`wasUpset` is computed fresh each call (no stored 3-state to lose). `isSeriesClinch`/
`isElimination` compare against a positive string enum (`importance`) where null
correctly means "false" — there's no separate "unknown clinch status" concept in
the schema. `finalizedAt` has no legitimate falsy-but-valid value to collide with.
This is isolated to `wentToOT`, not a systemic pattern in this function.

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write findings to outbox/cc-wenttoot-null-preserve-2026-07-12.md.

## PROBE BLOCK

```bash
grep -n "wentToOT: !!g.went_to_ot" src/index.js
sed -n '11278,11295p' src/index.js
```

Confirm the line and surrounding object literal still match what's cited above
before editing. If drift found, report and reconcile before proceeding.

## TASK 1 — Preserve the 3-state value through serialization

Replace:
```javascript
wentToOT: !!g.went_to_ot,
```
with:
```javascript
wentToOT: g.went_to_ot == null ? null : Boolean(g.went_to_ot),
```

This is not a fallback — it does not substitute a default for a missing value.
It's the fix: `null` stays `null` (unknown), `0` becomes `false` (confirmed not
OT), `1` becomes `true` (confirmed OT). Three states in, three states out.

## TASK 2 — Verification

```bash
node --check src/index.js
```

Then, against real data, confirm all three states are actually reachable in the
live response — not just that the code compiles:
```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/analytics/newspaper/$(date -d yesterday +%F)" \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
games = d.get('completed_games', [])
states = set(g.get('wentToOT') for g in games)
print('wentToOT values seen:', states)
print('sample:', games[0] if games else 'no completed games for this date')
"
```
Report the actual distinct values seen. A single day's slate may not contain all
three states (a day with no OT games and no missing data would show only
`false`) — if fewer than 3 states are observed, say so plainly rather than
claiming full verification; that is a real, honest residual, not a failure to fix.

Cross-check at least one real game directly against D1 to confirm the mapping is
correct:
```sql
SELECT id, went_to_ot FROM regular_season_games WHERE date = '<yesterday>' LIMIT 5;
```
Confirm each row's `went_to_ot` (1/0/NULL) maps to the correct `wentToOT`
(true/false/null) in the live curl response above.

## DONE CONDITION

`wentToOT: !!g.went_to_ot` no longer exists in src/index.js. The replacement is
live-verified against real D1 data for at least the 0-and-1 cases (both should be
reachable on almost any real date). The `null` case is verified if a real
instance exists in yesterday's data, honestly reported as unverified-today if
not — this is expected to be rare now, since the 2-hour backfill cron and the
original wiring CC-CMD's design mean most completed games should already have a
determined 0-or-1 value; a lingering `null` here would actually be an interesting
find, not just a test-completeness gap.

No client-side change is required for this CC-CMD — the current
`getWhatYouMissed` OR-chain (`... || g.wentToOT`) behaves identically whether it
receives `false` or `null` (both falsy), so this fix does not change current UI
behavior. What it does is stop silently deleting information a future feature
might need (a "data pending" indicator, or any consumer that needs to
distinguish "confirmed regulation" from "we don't know yet").

**Confidence scoring:**
- Probe confirms the exact cited line before editing (15 pts)
- Replacement is exactly the null-preserving ternary, no fallback default
  introduced (25 pts)
- `node --check` clean (10 pts)
- Live-verified against real `/analytics/newspaper` response + cross-checked
  against D1 for at least 2 of the 3 states (35 pts)
- Sibling-field audit re-confirmed (`wasUpset`/`isSeriesClinch`/`isElimination`/
  `finalizedAt` untouched, still correct) (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

## ONE-LINER
```
git pull. Read docs/CC-CMD-2026-07-12-wenttoot-null-preserve.md. Execute all tasks. Do not commit below 95 confidence.
```
