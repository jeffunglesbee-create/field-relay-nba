# CC-CMD: Consolidate remaining duplicate name maps into identity-resolver.js

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** `src/index.js` (remove two duplicate maps) + `src/identity-resolver.js` (add real, evidenced pairs) + `docs/CC-CMD-2026-07-05-upset-model-v2.md` (update reference).
**Separate from:** `CC-CMD-2026-07-05-consolidate-afl-normalization.md` (already pushed, handles `normAFL()` — do not duplicate that work here).

**Why — real, confirmed duplication, found while investigating the AFL
fix, not invented for this CC-CMD:** `identity-resolver.js` is the
established canonical name-resolution system (226 pairs, 14 call sites,
governed by "add real evidenced pairs only"). Two more independent,
duplicate implementations were found in `src/index.js`, confirmed
directly:

1. **`WC_NAME_FIX`** (line ~1546, `wcFixName()`, 4 real call sites) — 8
   real pairs: Czech Republic→Czechia, Bosnia & Herzegovina→Bosnia and
   Herzegovina, USA→United States, Turkey→Türkiye, Curacao→Curaçao,
   Cote D'Ivoire→Ivory Coast, Korea Republic→South Korea, Cape Verde
   Islands→Cape Verde.
2. **`FIFA_NAME_ALIASES`** (inline inside the `/fifa-rankings/` handler,
   ~line 7302, 1 call site) — 3 real pairs, confirmed live 2026-07-04
   against real Parse.bot data: cape verde→cabo verde, south korea→korea
   republic, ivory coast→côte d'ivoire.

These are not speculative additions — every pair already exists and is
already in real, working use. This CC-CMD migrates them into the one
canonical map rather than inventing anything new.

**Target time:** ~30 min

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
grep -n "WC_NAME_FIX\|wcFixName(" src/index.js
grep -n "FIFA_NAME_ALIASES" src/index.js
grep -n "function resolveTeamKey\|export {" src/identity-resolver.js
```
Re-confirm all call sites and pairs still match before editing.

## TASK 1 — Migrate both maps' real pairs into CANONICAL_TEAM

Add all 8 `WC_NAME_FIX` pairs and all 3 `FIFA_NAME_ALIASES` pairs to
`identity-resolver.js`'s `CANONICAL_TEAM` list, in the existing
WC/International section, with an inline comment noting they were
migrated from `src/index.js` (not new discoveries) — preserve the
evidence trail, don't present them as freshly found. Where a pair
already exists in `CANONICAL_TEAM` (e.g. `USA`→`United States` may
already be present — check before assuming it's new), skip the
duplicate rather than adding a conflicting second entry.

## TASK 2 — Replace both maps' call sites with resolveTeamKey

Replace all 4 `wcFixName(...)` call sites and the 1
`FIFA_NAME_ALIASES` lookup with `resolveTeamKey(...)` (import it if not
already imported in `index.js` — check first). Delete `WC_NAME_FIX`,
`wcFixName()`, and the inline `FIFA_NAME_ALIASES` object entirely once
their call sites are migrated — no dead code left behind.

## TASK 3 — Update upset-model-v2.md's reference

In `docs/CC-CMD-2026-07-05-upset-model-v2.md`, Task 1's instruction
currently says "reuse the alias handling already proven this session
(Cabo Verde, Korea Republic, Côte d'Ivoire naming mismatches)" —
referring to the now-removed `FIFA_NAME_ALIASES`. Update it to instead
say: use `resolveTeamKey()` from `identity-resolver.js` directly, since
that's now where these pairs live.

## TASK 4 — Verify no regression

Confirm existing WC/soccer functionality that depended on `wcFixName`
or the FIFA alias lookup still resolves the same real team names
correctly post-migration (e.g., a live `/fifa-rankings/Cape%20Verde`
call should still return the same real result it does today).

## SCOPE BOUNDARY

DO:
- Migrate only the real, already-existing pairs found in these two maps
- Check for pre-existing duplicates in CANONICAL_TEAM before adding
- Delete both source maps entirely once migrated
- Update upset-model-v2.md's stale reference
- Verify real functionality is unchanged post-migration

DO NOT:
- Touch normAFL() or drama-backfill.mjs — separate, already-pushed CC-CMD covers that
- Add any speculative pairs beyond the 11 real ones already confirmed
- Touch any of the 14 pre-existing resolveEntity/resolveTeamKey call sites

## DONE CONDITIONS
- [ ] Probe block re-run, all maps and call sites re-confirmed
- [ ] All real pairs migrated, duplicates-of-existing-entries skipped correctly
- [ ] Both source maps and all 5 call sites replaced with resolveTeamKey
- [ ] WC_NAME_FIX, wcFixName(), and FIFA_NAME_ALIASES fully deleted
- [ ] upset-model-v2.md's reference updated
- [ ] Real post-migration functionality verified (live FIFA rankings call for an aliased team)
- [ ] Outbox manifest written

## COMPLIANCE
- Rule 68: probe block first
- Rule 87: self-completing

## CONFIDENCE SCORING TABLE
+25  All 11 real pairs migrated correctly, pre-existing duplicates handled
+25  All 5 call sites replaced, both source maps fully deleted
+20  upset-model-v2.md reference updated
+30  Real post-migration functionality verified live, not assumed

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-consolidate-all-name-maps.md.
Migrate WC_NAME_FIX's 8 pairs and FIFA_NAME_ALIASES' 3 pairs into
identity-resolver.js's CANONICAL_TEAM (skip any already present).
Replace all 5 call sites with resolveTeamKey(), delete both source maps
entirely. Update upset-model-v2.md's stale reference to the removed
FIFA_NAME_ALIASES. Verify real functionality (e.g. a live FIFA rankings
call for an aliased team) still works post-migration. This is separate
from the already-pushed normAFL consolidation -- do not duplicate that
work. Do not commit unless confidence ≥ 95. If score < 95 report
verbatim and stop.
