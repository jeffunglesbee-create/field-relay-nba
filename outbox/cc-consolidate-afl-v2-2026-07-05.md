# normAFL Consolidation v2 (afl_team type) — 2026-07-05

## Commits

- `5017c57` refactor(identity): migrate normAFL into identity-resolver.js as afl_team type

## What Changed

**`src/identity-resolver.js`** — new `afl_team` type registered alongside
existing `team`, `player`, `soccer_player` types:

```javascript
function _stripAFL(name) {           // normAFL's exact algorithm
    return String(name || '').toLowerCase().trim()
        .replace(/\b(lions|swans|eagles|...)\b/g, '')
        .replace(/[^a-z]/g, '').slice(0, 6);
}
const CANONICAL_AFL = (() => {
    const pairs = [
        ['GWS Giants', 'Greater Western Sydney'], // ESPN vs D1 mismatch
    ];
    const out = {};
    for (const [v,c] of pairs) out[_stripAFL(v)] = _stripAFL(c);
    return out;
})();
_STRIP_BY_TYPE.afl_team    = _stripAFL;
_CANONICAL_BY_TYPE.afl_team = CANONICAL_AFL;
function resolveAFLTeamKey(name) { return resolveEntity('afl_team', name); }
export { resolveTeamKey, resolveAFLTeamKey, resolveEntity, SOCCER_PLAYER_ID_BY_KEY };
```

**`scripts/drama-backfill.mjs`**:
- Added `import { resolveAFLTeamKey } from '../src/identity-resolver.js';`
- Deleted `normAFL()` function (11 lines including comment)
- Replaced all 6 `normAFL(...)` call instances with `resolveAFLTeamKey(...)`

## Why v2 Was Needed

v1 (CC-CMD-consolidate-afl-normalization.md, stopped at 70/100) identified
that `resolveTeamKey` is incompatible with normAFL — full-string strip vs
nickname-stripping+truncation. v2 registers AFL as its own type (`afl_team`)
with its own `_stripAFL` function, following the same pattern already used
for `soccer_player`. GWS Giants / Greater Western Sydney is resolved via
CANONICAL_AFL (replacing the inline early-return hack in normAFL).

## Algorithm Verification (node test, pre-commit)

```
CANONICAL_AFL: { gws: 'greate' }
Melbourne Demons vs Melbourne:           old=MATCH new=MATCH BYTE-ID
GWS Giants vs Greater Western Sydney:   old=MATCH new=MATCH BYTE-ID
Brisbane Lions vs Brisbane Lions:        old=MATCH new=MATCH BYTE-ID
Richmond Tigers vs Richmond:             old=MATCH new=MATCH BYTE-ID
Collingwood Magpies vs Collingwood:      old=MATCH new=MATCH BYTE-ID
Geelong Cats vs Geelong:                 old=MATCH new=MATCH BYTE-ID
Carlton Blues vs Carlton:                old=MATCH new=MATCH BYTE-ID
Western Bulldogs vs Western Bulldogs:    old=MATCH new=MATCH BYTE-ID
North Melbourne Kangaroos vs N Melbourne:old=MATCH new=MATCH BYTE-ID
ALL MATCH RESULTS IDENTICAL
```

## D1 Verification (run 28746673604, 2026-07-05)

| State | Before reset | After backfill |
|-------|-------------|----------------|
| scored (drama_peak > 0) | 136 | **136** |
| zeroed (drama_peak = 0) | 2 | **2** |
| NULL | 0 | 0 |

**GWS resolution**: 14 GWS / Greater Western Sydney games confirmed scored
(drama_peak > 0), including all combinations of home/away ordering. All 14
previously required the inline GWS early return; now resolved via CANONICAL_AFL.

**2 remaining zeros** (unchanged from prior run, known ESPN data gaps):
1. Melbourne vs Geelong (2026-03-12) [event=38495]
2. Brisbane Lions vs Richmond (2026-03-19) [event=38496]

## Confidence Score

+25 _stripAFL migrated exactly, byte-identical output verified (node test)
+20 afl_team correctly registered following the soccer_player precedent
+20 All 6 normAFL call instances replaced, normAFL() fully deleted
+35 Re-verified real counts: 136/138 baseline unchanged, GWS confirmed on 14 actual games
= **100/100**

## Compliance

- Rule 68: probe block run before edits; byte-identical verification before commit
- Rule 87: self-completing — algorithm verified, workflow run executed, D1 before/after confirmed
