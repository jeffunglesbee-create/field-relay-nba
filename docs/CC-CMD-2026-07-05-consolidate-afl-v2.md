# CC-CMD: Consolidate normAFL — as its own registered type, not a forced fit into 'team'

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Supersedes:** `CC-CMD-2026-07-05-consolidate-afl-normalization.md`. That
attempt correctly, honestly stopped at 70/100 — `resolveTeamKey` is not
actually a drop-in replacement for `normAFL`, confirmed by direct
algorithm comparison, not just signature-matching. This version fixes
the real incompatibility instead of forcing an incorrect migration.

## Why the original attempt was wrong, specifically

`normAFL` strips known AFL nicknames via regex, then truncates to 6
chars — `"Melbourne"` → `"melbou"`, `"Melbourne Demons"` → strip
"demons" → `"melbou"`. Same result by design, which is why 136/138
games matched correctly. `resolveTeamKey` (the general `team` type)
only strips diacritics/non-alphanumerics, keeping the full string —
`"Melbourne"` → `"melbourne"`, `"Melbourne Demons"` → `"melbournedemons"`.
These never match. Same function shape (one arg in, one string out),
genuinely incompatible output. Forcing AFL through the general `team`
type would have silently broken all 136 currently-working matches, not
just failed to fix GWS.

## The actual fix — register AFL as its own type, not a data migration

`identity-resolver.js` already has exactly this pattern, proven twice:
`player` and `soccer_player` are separate registered types, each with
its own strip algorithm, dispatched via:
```javascript
const _CANONICAL_BY_TYPE = { team: CANONICAL_TEAM, player: CANONICAL_PLAYER };
const _STRIP_BY_TYPE = { team: _strip, player: _stripPlayer };
// later:
_STRIP_BY_TYPE.soccer_player    = _stripPlayerSoccer;
_CANONICAL_BY_TYPE.soccer_player = CANONICAL_PLAYER_SOCCER;
```
Add `afl_team` the same way — migrate `normAFL`'s exact existing
algorithm as `_stripAFL`, register it, and give it its own
`CANONICAL_AFL` map (starting with just the one real, evidenced GWS
pair — do not invent the other ~18 team pairs; they were never actually
needed, since normAFL's nickname-stripping already handles them
correctly without an explicit pair for each team).

**Target time:** ~20 min

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
grep -n "function normAFL" scripts/drama-backfill.mjs -A 6
grep -n "_STRIP_BY_TYPE\|_CANONICAL_BY_TYPE\|soccer_player" src/identity-resolver.js
```
Re-confirm both algorithms and the extension pattern still match before
editing.

## TASK 1 — Migrate normAFL's exact algorithm into identity-resolver.js as a new type

In `identity-resolver.js`, add:
```javascript
function _stripAFL(name) {
  return String(name || '').toLowerCase()
    .replace(/\b(lions|swans|eagles|hawks|magpies|bombers|cats|blues|tigers|bulldogs|kangaroos|power|crows|demons|dockers|suns|giants|saints|roos)\b/g, '')
    .replace(/[^a-z]/g, '').slice(0, 6);
}
const CANONICAL_AFL = (() => {
  const pairs = [
    ['GWS Giants', 'Greater Western Sydney'], // real, evidenced mismatch, found 2026-07-05
  ];
  const out = {};
  for (const [variant, canonical] of pairs) out[_stripAFL(variant)] = _stripAFL(canonical);
  return out;
})();
_STRIP_BY_TYPE.afl_team = _stripAFL;
_CANONICAL_BY_TYPE.afl_team = CANONICAL_AFL;
```
Export a convenience wrapper if useful: `function resolveAFLTeamKey(name) { return resolveEntity('afl_team', name); }`.

Verify the migrated `_stripAFL` produces byte-identical output to the
original `normAFL` for both example cases above before proceeding —
this must be an exact port, not a reimplementation.

## TASK 2 — Replace normAFL() call sites in drama-backfill.mjs

Import `resolveAFLTeamKey` (or `resolveEntity` directly with
`'afl_team'`) from `identity-resolver.js`. Replace all 4 `normAFL(...)`
call sites. Delete `normAFL()` entirely.

## TASK 3 — Verify no regression, and that GWS now resolves

Re-run the AFL backfill (or an equivalent dry-run check). Confirm the
same 136/138 real-scored baseline holds, AND that the GWS Giants /
Greater Western Sydney pairing now correctly matches (previously one of
the 2 unresolved zero-cases' siblings — confirm precisely which real
games this affects, don't assume).

## SCOPE BOUNDARY

DO:
- Migrate normAFL's exact existing algorithm as a new registered type
- Add only the one real, evidenced GWS pair — no invented team pairs
- Verify byte-identical output before and after migration
- Delete normAFL() only after the replacement is confirmed working

DO NOT:
- Force AFL through the general 'team' type or its CANONICAL_TEAM map
- Invent the other ~18 AFL team pairs — confirmed unnecessary, normAFL's nickname-stripping already handles them
- Touch WC_NAME_FIX or FIFA_NAME_ALIASES — separate, already-pushed CC-CMD covers those

## DONE CONDITIONS
- [ ] Probe block re-run, both algorithms and the extension pattern re-confirmed
- [ ] _stripAFL migrated exactly, verified byte-identical to normAFL's output
- [ ] afl_team registered in both dispatch tables, CANONICAL_AFL seeded with only the one real GWS pair
- [ ] All 4 call sites replaced, normAFL() deleted
- [ ] Re-verified 136/138 baseline holds, GWS resolution confirmed on the specific real affected game(s)
- [ ] Outbox manifest written

## CONFIDENCE SCORING TABLE
+25  _stripAFL migrated exactly, byte-identical output verified
+20  afl_team correctly registered following the soccer_player precedent
+20  All 4 call sites replaced, normAFL() fully deleted
+35  Re-verified real counts: 136/138 baseline unchanged, GWS resolution confirmed on actual affected game(s)

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-consolidate-afl-v2.md. This
supersedes the prior attempt, which correctly stopped at 70/100 because
resolveTeamKey's algorithm is genuinely incompatible with normAFL's
(nickname-stripping+truncation vs full-string) -- do not force AFL
through the general 'team' type. Instead, migrate normAFL's exact
algorithm into identity-resolver.js as a new registered type (afl_team),
following the same pattern already used for soccer_player. Seed
CANONICAL_AFL with only the one real GWS pair -- do not invent the
other ~18 team pairs, confirmed unnecessary. Replace all 4 call sites,
delete normAFL(), verify the 136/138 baseline holds and GWS now
resolves. Do not commit unless confidence ≥ 95. If score < 95 report
verbatim and stop.
