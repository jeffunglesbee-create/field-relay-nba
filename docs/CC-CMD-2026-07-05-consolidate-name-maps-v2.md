# CC-CMD: WC_NAME_FIX / FIFA_NAME_ALIASES consolidation v2 — correct architecture, not a forced fit

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Supersedes:** `CC-CMD-2026-07-05-consolidate-all-name-maps.md`. That
attempt correctly, honestly stopped at 45/100 — three real, distinct
problems, not one. This version targets the actual architecture needed.

## Why the original attempt was wrong

`wcFixName`'s 4 call sites write directly into D1 INSERT statements —
they need a human-readable canonical name ("South Korea"), and
`resolveTeamKey` only ever returns a strip-form match-key
("southkorea"). Migrating would write unreadable values into
`wc_results`. `FIFA_NAME_ALIASES`'s handler compares against Parse.bot's
**raw, unstripped** en-GB descriptions ("cabo verde", with a space) —
`resolveTeamKey`'s stripped output ("caboverde") would never match, a
real functional break, not a style issue. And `FIFA_NAME_ALIASES` maps
FIELD-canonical→FIFA-vocabulary — the *opposite* direction from
`CANONICAL_TEAM`'s variant→canonical — merging it as-is would silently
flip existing entries (`"southkorea"` from self-mapping to
`"korearepublic"`), breaking real, working WC game matching.

**The real fix: these solve a different problem than `resolveTeamKey`
does (canonical display name, not a comparison key) — so the target was
wrong, not just the migration mechanics.**

**Target time:** ~30 min

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
sed -n '31,45p' src/identity-resolver.js
grep -n "wcFixName(" src/index.js
grep -n "FIFA_NAME_ALIASES" src/index.js -A5
```
Re-confirm the pairs-list shape and all call sites before editing.

## TASK 1 — Add resolveTeamName(), capturing the human-readable form already present at build time

`CANONICAL_TEAM`'s own construction already has raw `[variant,
canonical_human]` string pairs before strip-encoding — this data isn't
being invented, it's already there and currently discarded. In the same
IIFE, also build a second map keyed by strip-form → the human-readable
`canonical_human` string. Export a new function:
```javascript
function resolveTeamName(name) {
  const k = _strip(name);
  return CANONICAL_TEAM_DISPLAY[k] || name; // fall back to input if no known pair
}
```
Add `resolveTeamName` to the module's `export { ... }` list.

## TASK 2 — Migrate the 4 wcFixName call sites to resolveTeamName

Replace `wcFixName(...)` with `resolveTeamName(...)` at lines
~1764/1765/2429/2430. Add the one genuinely new, safe pair
(`['Cape Verde Islands', 'Cape Verde']`) to `CANONICAL_TEAM`'s pairs
list — confirmed 7/8 `WC_NAME_FIX` pairs already exist, only this one
is new. Delete `WC_NAME_FIX` and `wcFixName()` once call sites are
migrated and verified.

## TASK 3 — Fix FIFA_NAME_ALIASES correctly, don't merge into CANONICAL_TEAM

Do NOT add FIFA_NAME_ALIASES' pairs to `CANONICAL_TEAM` — confirmed
direction-incompatible. Instead: keep `FIFA_NAME_ALIASES` as its own
small, explicitly-labeled table (it's a FIELD-canonical→one-specific-
upstream's-vocabulary translation, a genuinely different kind of lookup
than "which names refer to the same team") — but make its *input*
deterministic by running the incoming team name through
`resolveTeamName()` first, so the alias table only needs to key off
FIELD's own canonical names, not every raw variant a caller might pass.
Keep the lookup comparison against Parse.bot's raw strings exactly as
it is now (lowercase, unstripped) — do not touch that part, it's
correct for what it's matching against.

## TASK 4 — Verify no regression

Confirm real, live behavior post-change:
1. A `/fifa-rankings/Cape Verde` call still returns real, correct data (same as before).
2. `wc_results` D1 writes at the 4 migrated call sites still produce human-readable values ("South Korea", not "southkorea") — check a real row after a write, don't assume from code review alone.
3. Existing South Korea/Korea Republic WC matching via `resolveTeamKey` is unchanged (no direction flip).

## SCOPE BOUNDARY

DO:
- Add resolveTeamName() by capturing already-present build-time data, not a new independent map
- Migrate wcFixName's 4 sites, add the one genuinely-new safe pair
- Keep FIFA_NAME_ALIASES separate but feed it through resolveTeamName() first
- Verify real D1 writes and real API behavior post-change, not just code review

DO NOT:
- Add FIFA_NAME_ALIASES' pairs to CANONICAL_TEAM in either direction
- Replace wcFixName with resolveTeamKey anywhere — confirmed wrong output shape
- Touch the AFL consolidation — separate, already-pushed CC-CMD (v2) covers that

## DONE CONDITIONS
- [ ] Probe block re-run, all shapes and call sites re-confirmed
- [ ] resolveTeamName() added, capturing existing build-time data
- [ ] wcFixName's 4 sites migrated, WC_NAME_FIX/wcFixName deleted
- [ ] FIFA_NAME_ALIASES kept separate, fed through resolveTeamName() first
- [ ] Real post-change verification: live FIFA call, real D1 row check, unchanged South Korea/Korea Republic matching
- [ ] Outbox manifest written

## CONFIDENCE SCORING TABLE
+25  resolveTeamName() correctly captures existing data, no new parallel map to maintain
+25  wcFixName migration correct, verified via real D1 row, not assumed
+25  FIFA_NAME_ALIASES correctly left separate but fed through resolveTeamName()
+25  Real post-change verification on all three fronts (FIFA call, D1 write, WC matching)

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-consolidate-name-maps-v2.md. This
supersedes the prior attempt, which correctly stopped at 45/100 --
resolveTeamKey's strip-form output is the wrong shape for both
wcFixName's D1-writing call sites (need human-readable) and
FIFA_NAME_ALIASES' raw-string comparison (need unstripped). Add
resolveTeamName() by capturing the human-readable canonical already
present in CANONICAL_TEAM's build-time pairs list -- don't invent a new
parallel map. Migrate wcFixName's 4 call sites to it, add the one
genuinely-new safe pair. Keep FIFA_NAME_ALIASES separate (direction-
incompatible with CANONICAL_TEAM) but feed its input through
resolveTeamName() first. Verify real D1 writes and live FIFA behavior
post-change, not just code review. Do not commit unless confidence ≥
95. If score < 95 report verbatim and stop.
