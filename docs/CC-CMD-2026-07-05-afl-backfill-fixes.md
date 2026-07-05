# CC-CMD: Fix both AFL backfill gaps — GWS alias + ESPN limit param

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** `scripts/drama-backfill.mjs` only — two small, independently-verified fixes.

**Real starting state**: 80/138 AFL games scored, 58 zero (honest no-match/
no-data, not silent failures — each logged). Two distinct, confirmed causes:

**Fix 1 — GWS name mismatch (~12 games).** Confirmed directly:
`normAFL("GWS Giants")` → `"gws"` (nickname "giants" stripped).
`normAFL("Greater Western Sydney")` → `"greate"` (no nickname to strip,
truncated at 6 chars). These share zero characters — will never match as
written. Add an explicit alias before normalization: if the raw team name
contains "greater western sydney" (case-insensitive), treat it as "gws"
directly, rather than relying on the generic nickname-stripping path for
this one team.

**Fix 2 — ESPN coverage gap (~46 games, rounds 11-17).** Confirmed
directly: `?dates=2026` alone caps at 100 events, ending 2026-05-21.
Adding `&limit=500` to the same query returns 216 events, spanning
2026-02-25 through 2026-08-17 — the entire season plus finals. This is
simpler than date-range chunking (which also works but requires multiple
calls) — use the single `&limit=500` addition.

**Target time:** ~15 min

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
grep -n "function normAFL" scripts/drama-backfill.mjs -A 8
grep -n "dates=2026" scripts/drama-backfill.mjs
curl -s "https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard?dates=2026&limit=500" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('events',[])))"
```
Re-confirm both — the limit=500 behavior in particular could change if
ESPN adjusts server-side pagination caps.

## TASK 1 — Fix the ESPN fetch URL

Add `&limit=500` to the existing scoreboard fetch URL. One-line change.

## TASK 2 — Fix GWS matching

Before calling `normAFL()` on the D1-side team name, check for "greater
western sydney" (case-insensitive substring) and map it to `"gws"`
directly, bypassing the generic normalizer for this one case. Do not
modify `normAFL()`'s general nickname-stripping logic — this is a
targeted alias for one known real mismatch, not a rework of the whole
function.

## TASK 3 — Run it, verify real improvement

Re-trigger `drama-backfill.yml`. Query D1 directly: report the real new
before/after AFL counts. Expected direction: scored count should rise
from 80 (both GWS games and previously-out-of-window games should now
resolve) — report the actual number, don't assume the exact total
without checking. Any remaining zero-matches after this fix should be
individually explainable (a different, new mismatch found, or a
genuinely uncoverable game) — don't wave away unexplained remainders
as "expected" without checking what they actually are.

## SCOPE BOUNDARY

DO:
- Add exactly `&limit=500` to the AFL scoreboard fetch
- Add exactly one targeted GWS alias, not a general rework of normAFL()
- Report real, re-verified before/after counts

DO NOT:
- Touch MLB, WNBA, EPL, or golf/PGA — unrelated, already settled
- Rework normAFL()'s general nickname-stripping approach — only add the one targeted GWS case
- Assume the fix is complete without re-querying D1 for real numbers

## DONE CONDITIONS
- [ ] Probe block re-run, both root causes re-confirmed
- [ ] limit=500 added to the fetch URL
- [ ] GWS alias added as a targeted special case
- [ ] Workflow run, real new before/after counts reported and any remaining zeros explained
- [ ] Outbox manifest written with real evidence

## COMPLIANCE
- Rule 68: probe block first
- Rule 87: self-completing — both fixes are small, real, and immediately verifiable

## CONFIDENCE SCORING TABLE
+30  limit=500 added correctly, confirmed returning the full season
+30  GWS alias added correctly, targeted not general
+25  Workflow run, real improved counts confirmed via D1
+15  Any remaining zero-matches explained, not hand-waved

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-afl-backfill-fixes.md. Add
&limit=500 to the AFL ESPN scoreboard fetch URL (confirmed this alone
returns the full season, 216 events through August, vs 100 capped at
May 21). Add a targeted alias mapping "Greater Western Sydney" to "gws"
before normAFL() runs -- confirmed these two normalize to completely
different strings otherwise. Re-run the workflow and report real new
before/after AFL counts from D1, explaining any remaining zero-matches
rather than assuming they're all accounted for. Do not commit unless
confidence ≥ 95. If score < 95 report verbatim and stop.
