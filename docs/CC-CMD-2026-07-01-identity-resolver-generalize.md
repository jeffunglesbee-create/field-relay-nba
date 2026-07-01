# Claude Code Command — Generalize Identity Resolver (resolveTeamKey → resolveEntity)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-identity-resolver-generalize-2026-07-01.md.

## CONTEXT

`identity-resolver.js` currently resolves exactly one entity type (teams):
298 lines, 2 functions (`_strip`, `resolveTeamKey`), 1 export, 226
name-pairs in a single `CANONICAL` map. 14 real call sites already
depend on `resolveTeamKey` (10 in `index.js`, 4 in `context-assembler.js`).

Multiple proposed FIELD graphs (Relationship, Narrative player-arc,
Discovery's "Player Story") all cite player identity as a dependency
that currently has zero foundation — not partial, zero. This CC-CMD
generalizes the *proven pattern* (strip diacritics → lowercase → drop
non-alphanumerics → CANONICAL lookup) from team-only to type-keyed,
without changing team behavior at all.

**Explicitly NOT in scope:** populating the Player map with real name
variants. Checked directly — no existing player-name alias/normalization
logic exists anywhere in the relay to migrate (grepped `index.js` and
`context-assembler.js`, zero matches). The team map's own header
documents it was built from "observed D1 mismatches probed June 21
2026" — real incidents, not invented pairs. The Player map must start
empty for the same reason: inventing plausible-sounding player name
variants without evidence would be fabrication, not migration. It gets
populated the same way the team map grew — a real mismatch gets found
(like the Bosnia-Herz bug tonight), gets added as one pair, in a future
CC-CMD, with the specific evidence documented inline.

## PRE-BUILD PROBE (Rule 87)

```bash
cat src/identity-resolver.js
grep -rn "resolveTeamKey(" src/index.js src/context-assembler.js
```

Confirm the exact current 14 call sites and their exact invocation
pattern (`resolveTeamKey(x)`) before touching anything — the refactor
must not require changing any of them.

## TASK 1: Rename CANONICAL → CANONICAL_TEAM (zero behavior change)

Rename the existing `CANONICAL` const to `CANONICAL_TEAM`. No other
change to its construction, the `pairs` array, or `_strip()`. This is
pure rename — verify via diff that the only change in this block is the
identifier.

## TASK 2: Add empty CANONICAL_PLAYER, built via the same pattern

```javascript
// stripForm → canonical stripForm, for player names. Empty by design —
// no real observed player-name mismatches exist yet (verified: grepped
// the whole relay for existing player-alias logic, zero matches, nothing
// to migrate). Populate this the same way CANONICAL_TEAM grew: a real
// mismatch surfaces (like the Bosnia-Herz identity bug, 2026-07-01),
// gets added as one documented pair with the evidence inline — never
// speculative entries.
const CANONICAL_PLAYER = (() => {
    const pairs = [
        // (intentionally empty — see comment above)
    ];
    const out = {};
    for (const [variant, canonical] of pairs) {
        out[_strip(variant)] = _strip(canonical);
    }
    return out;
})();
```

## TASK 3: Add resolveEntity(type, name), generic dispatcher

```javascript
const _CANONICAL_BY_TYPE = { team: CANONICAL_TEAM, player: CANONICAL_PLAYER };

/**
 * Resolve an entity name to a canonical strip-form key, keyed by type.
 * Pass the same input from EITHER side of a comparison and the keys
 * are equal when the names refer to the same entity.
 *
 * @param {string} type - 'team' | 'player'
 * @param {string|null|undefined} name
 * @returns {string} canonical strip-form (empty string for empty input
 *   or unrecognized type)
 */
function resolveEntity(type, name) {
    const k = _strip(name);
    if (!k) return '';
    const map = _CANONICAL_BY_TYPE[type];
    if (!map) return k;
    return map[k] || k;
}
```

## TASK 4: Keep resolveTeamKey as a thin, behavior-identical wrapper

```javascript
function resolveTeamKey(name) {
    return resolveEntity('team', name);
}
```

This preserves the exact existing signature and behavior for all 14
current call sites — confirm via the probe's call-site list that none
of them need to change.

## TASK 5: Update exports

```javascript
export { resolveTeamKey, resolveEntity };
```

`resolveTeamKey` stays exported (backward compat, unchanged behavior).
`resolveEntity` is newly exported for future callers (player-identity
features, when they're actually built).

## TASK 6: Verification

```bash
node -c src/identity-resolver.js
grep -c "resolveTeamKey(" src/index.js src/context-assembler.js
```

Done condition: syntax valid, call-site counts in `index.js` (10) and
`context-assembler.js` (4) unchanged from the pre-build probe — confirms
zero call sites needed modification. If any deployed smoke/CI exists for
this repo, must stay green.

**Chat-side follow-up (not checkable by CC):** confirm live via a
`resolveTeamKey()`-dependent code path (e.g. `/odds-story/preview` or the
BSD/Odds join) still produces identical output post-deploy — same
verification standard used for every other identity-resolver change
tonight.

## TASK 7: Outbox manifest (last task)

Note explicitly: `CANONICAL_PLAYER` ships empty and `resolveEntity` has
no real callers yet — this CC-CMD builds the foundation only. State
plainly that "player identity resolution" is not yet a working feature,
just an available primitive, so this isn't mistaken for more than it is.
