# Claude Code Command — Generalize Identity Resolver (CORRECTED v2)

**SUPERSEDES the original version of this file** (identical filename,
overwritten in place — the original was never executed, confirmed via
direct check of `src/identity-resolver.js` and the codex queue status
before this rewrite). The original design used one shared `_strip()`
algorithm for all entity types. That was wrong, discovered before
execution, not after — see CONTEXT.

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-identity-resolver-generalize-2026-07-01.md.

## CONTEXT — why this version differs from the original

Investigating how `resolveEntity` would actually connect to real player
data surfaced a real, evidence-based problem with the original design:
**four independently-evolved name-normalization schemes already exist**
in this codebase, and the original spec would have added a fifth,
incompatible with the three that touch real player data:

| Scheme | Location | Diacritic handling | Suffix handling |
|---|---|---|---|
| `_strip()` | `identity-resolver.js` (this file, teams) | NFD-strips accents | n/a |
| `lastNameOf()` | `index.html` (client, pitch arsenal/tempo consumer) | Preserves accents | n/a |
| `name_key()` | `mlb-weekly-update.py` (Python, pitch arsenal/tempo/team_abs producer) | Preserves accents | Strips Jr./Sr./II/III |
| inline umpire normalizer | `mlb-weekly-update.py` + backfill script | Preserves accents | No suffix handling |

The client and Python schemes agree with each other by coincidence (both
preserve accents) — that's why `pitch_arsenals.json`/`pitch_tempo.json`
already work correctly for the Scouting Report and At-Bat Edge features
shipped tonight. `_strip()`'s NFD diacritic-stripping is correct FOR
TEAMS (proven: it's what the Bosnia identity fix relied on), but if
`CANONICAL_PLAYER` reused it, a player like "Ramírez" would resolve to
`ramirez` while every real Savant-derived key stays `ramírez` — silently
unresolvable, the exact bug class already found once tonight (Bosnia),
just not yet triggered because nothing currently bridges relay identity
resolution to Savant player data.

**Decision: player identity gets its own stripForm, matching the
convention already live in `name_key()`/`lastNameOf()`** — not the
team convention. Re-keying the three already-shipped Savant files to
match `_strip()` instead was considered and rejected: it means touching
production data that's currently correct for its actual purpose, for no
benefit, when giving players a second, correct algorithm is cheaper and
lower-risk.

**Umpire normalization is explicitly OUT OF SCOPE** — deferred, not
dropped. No current use case needs umpire identity resolved against
player or team identity. Do not attempt to unify it here.

## PRE-BUILD PROBE (Rule 87)

```bash
cat src/identity-resolver.js
grep -rn "resolveTeamKey(" src/index.js src/context-assembler.js
```

Confirm the exact current 14 call sites and file shape before touching
anything — the refactor must not require changing any of them. Also
re-confirm `name_key()`'s exact current implementation in
`mlb-weekly-update.py` (jubilant-bassoon repo — this CC-CMD runs against
field-relay-nba, but the player stripForm here MUST match that function
exactly; fetch it fresh rather than trusting the table above, which is
a snapshot from the investigation, not a live read at execution time).

## TASK 1: Rename CANONICAL → CANONICAL_TEAM (zero behavior change)

Rename the existing `CANONICAL` const to `CANONICAL_TEAM`. No other
change to its construction, the `pairs` array, or `_strip()`. Pure
rename — verify via diff that the only change in this block is the
identifier.

## TASK 2: Add a SEPARATE player stripForm, matching the live Python/client convention

```javascript
// Player-specific strip form — deliberately DIFFERENT from _strip().
// _strip() NFD-strips diacritics (correct for teams, proven by the
// Bosnia identity fix). Players need the OPPOSITE: preserve diacritics,
// to match name_key() (mlb-weekly-update.py, Python) and lastNameOf()
// (index.html, client) — the two functions that already generate and
// consume real Savant-derived player keys (pitch_arsenals.json,
// pitch_tempo.json). If this stripped diacritics like _strip() does,
// it would never match real data. Verified via direct code read,
// 2026-07-01 — do not "fix" this to match _strip() without re-verifying
// name_key() hasn't changed.
function _stripPlayer(name) {
    let s = String(name || '').toLowerCase();
    s = s.replace(/ jr\.?$/, '').replace(/ sr\.?$/, '')
         .replace(/ ii$/, '').replace(/ iii$/, '');
    return s.replace(/[\s-]/g, '_');
}
```

Confirm this produces IDENTICAL output to `name_key()` for several real
sample names pulled fresh from `pitch_arsenals.json` during verification
— do not assume the pseudocode above is byte-exact without checking.

## TASK 3: Add empty CANONICAL_PLAYER, built via the player stripForm

```javascript
// Empty by design — no real observed player-name mismatches exist yet
// (verified: grepped the whole relay for existing player-alias logic
// prior session, zero matches). Populate this the same way
// CANONICAL_TEAM grew: a real mismatch surfaces, gets added as one
// documented pair with evidence inline — never speculative entries.
const CANONICAL_PLAYER = (() => {
    const pairs = [
        // (intentionally empty — see comment above)
    ];
    const out = {};
    for (const [variant, canonical] of pairs) {
        out[_stripPlayer(variant)] = _stripPlayer(canonical);
    }
    return out;
})();
```

## TASK 4: Add resolveEntity(type, name) — dispatches to the RIGHT stripForm per type

```javascript
const _CANONICAL_BY_TYPE = { team: CANONICAL_TEAM, player: CANONICAL_PLAYER };
const _STRIP_BY_TYPE = { team: _strip, player: _stripPlayer };

/**
 * Resolve an entity name to a canonical strip-form key, keyed by type.
 * IMPORTANT: team and player use DIFFERENT normalization algorithms —
 * see _stripPlayer's comment for why. Do not assume one strip function
 * works for both.
 *
 * @param {string} type - 'team' | 'player'
 * @param {string|null|undefined} name
 * @returns {string} canonical strip-form (empty string for empty input
 *   or unrecognized type)
 */
function resolveEntity(type, name) {
    const stripFn = _STRIP_BY_TYPE[type];
    if (!stripFn) return '';
    const k = stripFn(name);
    if (!k) return '';
    const map = _CANONICAL_BY_TYPE[type];
    return map[k] || k;
}
```

## TASK 5: Keep resolveTeamKey as a thin, behavior-identical wrapper

```javascript
function resolveTeamKey(name) {
    return resolveEntity('team', name);
}
```

Confirm this preserves exact existing behavior for all 14 current call
sites — none of them should need to change.

## TASK 6: Update exports

```javascript
export { resolveTeamKey, resolveEntity };
```

## TASK 7: Verification

```bash
node -c src/identity-resolver.js
grep -c "resolveTeamKey(" src/index.js src/context-assembler.js
```

**Additionally, and this is the part the original spec didn't require:**
pull a real sample of 5+ keys from the live `pitch_arsenals.json`
(jubilant-bassoon repo, `outbox/mlb/pitch_arsenals.json`) and confirm
`resolveEntity('player', fullNameForm)` for each produces a key that
EXACTLY matches one of those real JSON keys. This is the test that
actually validates the corrected design — the original spec had no
equivalent check and would have shipped a resolver that silently
couldn't resolve real players.

Done condition: syntax valid, call-site counts unchanged (10 in
`index.js`, 4 in `context-assembler.js`), AND the cross-repo key-match
check above passes for real sampled data, not synthetic examples.

## TASK 8: Outbox manifest (last task)

State explicitly: the real sample names checked and their matched keys,
confirmation that `_stripPlayer` output byte-matches `name_key()` for
those samples, and that `CANONICAL_PLAYER` ships empty with `resolveEntity`
having no real callers yet — this CC-CMD builds a correctly-connectable
foundation, not a working player-identity feature.
