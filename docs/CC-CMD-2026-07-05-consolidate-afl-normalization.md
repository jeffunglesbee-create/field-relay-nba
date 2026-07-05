# CC-CMD: Consolidate normAFL() into the canonical identity-resolver

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** `scripts/drama-backfill.mjs` (remove duplicate) + `src/identity-resolver.js` (add one real pair). No other files.

**Why — real, confirmed duplication, not a style preference:** last
night's AFL fix built a standalone `normAFL()` inside
`drama-backfill.mjs` to fix a real GWS Giants / Greater Western Sydney
mismatch. `identity-resolver.js` already has an established, governed
canonical name-resolution system (`resolveEntity`/`resolveTeamKey`,
226 real pairs, 14 existing call sites) with an explicit rule: new
pairs get added from real, observed mismatches with evidence inline —
exactly what the GWS discovery was. Confirmed directly, no technical
obstacle exists: `identity-resolver.js` is a pure ES module
(`export { resolveTeamKey, resolveEntity, ... }`), zero dependency on
Worker-only runtime globals — `drama-backfill.mjs` already imports
other ES modules in this same execution context
(`import { setTimeout as sleep } from 'node:timers/promises'`).
`resolveTeamKey(name)` has the identical one-arg-in/one-string-out
shape `normAFL(s)` already has — this is a direct, drop-in replacement,
not a redesign.

**Target time:** ~15 min

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
grep -n "normAFL(" scripts/drama-backfill.mjs
grep -n "function resolveTeamKey\|export {" src/identity-resolver.js
```
Re-confirm all 4 call sites and the export statement still match before
editing — this doc's snapshot is 2026-07-05.

## TASK 1 — Add the GWS pair to the canonical map, with evidence

In `src/identity-resolver.js`'s `CANONICAL_TEAM` pairs list, add (in the
same section style as existing WC/International entries):
```javascript
['GWS Giants',              'Greater Western Sydney'],
```
Comment inline with the real evidence: ESPN's AFL scoreboard stores this
team as "GWS Giants"; D1's `regular_season_games` stores it as "Greater
Western Sydney" — confirmed mismatch, found 2026-07-05 during the AFL
drama backfill, all 12 affected games silently failed to match before
this fix.

## TASK 2 — Replace normAFL() with resolveTeamKey, remove the duplicate

Import `resolveTeamKey` from `identity-resolver.js` in
`drama-backfill.mjs` (confirm the correct relative import path from
`scripts/` to `src/` — verify it resolves, don't assume `../src/...`
without checking the actual directory structure). Replace all 4 call
sites (`normAFL(homeName)`, `normAFL(awayName)`, `normAFL(game.home)`,
`normAFL(game.away)`) with `resolveTeamKey(...)`. Delete the standalone
`normAFL()` function entirely — no dead code left behind.

## TASK 3 — Verify no regression

Re-run the AFL portion of the backfill (or a dry-run matching pass, if
a full workflow run isn't necessary to verify this specific change) and
confirm the same 136/138 real-scored count holds — this change should
be behavior-neutral for every case except GWS, which should now also
correctly resolve (previously handled by the ad-hoc normAFL fix; confirm
it still does via the canonical path).

## SCOPE BOUNDARY

DO:
- Add exactly one real, evidenced pair to CANONICAL_TEAM
- Replace normAFL() with resolveTeamKey() at all 4 call sites, verified via re-grep
- Delete the duplicate function entirely
- Verify the AFL backfill still produces the same real counts

DO NOT:
- Add any other speculative team-name pairs "while you're in there" — only the one real, evidenced GWS mismatch
- Touch any of the 14 existing resolveEntity/resolveTeamKey call sites elsewhere in the relay
- Change resolveEntity's or resolveTeamKey's own implementation

## DONE CONDITIONS
- [ ] Probe block re-run, current state confirmed
- [ ] GWS pair added to CANONICAL_TEAM with evidence comment
- [ ] All 4 normAFL call sites replaced with resolveTeamKey, import path verified working
- [ ] normAFL() function deleted entirely
- [ ] Re-verified AFL backfill produces the same real counts (136/138 or better)
- [ ] Outbox manifest written

## COMPLIANCE
- Rule 68: probe block first
- Rule 87: self-completing — this is a small, real, immediately verifiable consolidation

## CONFIDENCE SCORING TABLE
+20  GWS pair added correctly with real evidence comment
+30  All 4 call sites replaced, import path verified working, no assumption
+20  normAFL() fully deleted, no dead code
+30  Re-verified real AFL counts unchanged or improved

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-consolidate-afl-normalization.md.
Add the GWS Giants / Greater Western Sydney pair to identity-resolver.js's
CANONICAL_TEAM map with an evidence comment. Import resolveTeamKey into
drama-backfill.mjs (verify the real relative import path, don't assume
it), replace all 4 normAFL() call sites with it, delete normAFL()
entirely. Re-verify the AFL backfill still produces the same real
counts. Do not commit unless confidence ≥ 95. If score < 95 report
verbatim and stop.
