# Stop Logging Known-Unsupported Sports as WP Resolution Failures — 2026-07-08

## What Was Built

`wp-resolution-failures` (codex, category `incident`) previously logged every
`null` return from `resolveWinProbability()` as a failure, with no distinction
between a genuine resolution failure (real data source, something went wrong)
and a correctly-unsupported sport (Golf, Tennis, Rugby, etc. — `SPORT_LABEL_MAP`
maps these to `null` on purpose). The second case recurs forever, permanently
and expectedly, for every pick made on an unsupported sport — and would bury
any future genuine failure under expected noise.

This CC-CMD adds a single-source-of-truth check and guards the one call site
that logs case-2 noise, leaving case-1 diagnostics completely untouched.

## Probe Results (all confirmed before editing)

```
git log --oneline -5         → HEAD matched doc assumption (035c965)
SPORT_LABEL_MAP              → found, single module-level declaration (line 89)
normalizeSportCode           → found (line 156)
resolveWinProbability        → found (line 346, export async function)
isWpUnsupportedSport         → zero matches (confirmed genuinely new)
_recordWpResolutionFailure   → 3 hits in user-do.js (2 call sites + definition)
import line                  → `import { resolveWinProbability } from './wp-resolver.js';` (exact match)
package.json scripts         → none (no "scripts" key at all)
*.test.js / *smoke*.js       → none found
```

## Changes

### `src/wp-resolver.js` — pure addition, zero changes to existing functions

Added `isWpUnsupportedSport(sport)` after `normalizeSportCode()`. Exact-match-only
against `SPORT_LABEL_MAP` (does not reuse `normalizeSportCode`'s fallback substring
matching, since every fallback branch there returns a real supported code, never
`null` — an exact-match check is sufficient). A genuinely unrecognized string still
returns `false`, so it continues to surface as a failure rather than being silently
swallowed.

```javascript
export function isWpUnsupportedSport(sport) {
    if (!sport) return false;
    const raw = String(sport).toLowerCase().trim();
    return Object.prototype.hasOwnProperty.call(SPORT_LABEL_MAP, raw)
        && SPORT_LABEL_MAP[raw] === null;
}
```

`resolveWinProbability()` and `normalizeSportCode()` are byte-for-byte unchanged.

### `src/user-do.js` — one guarded call site, catch block untouched

```javascript
import { resolveWinProbability, isWpUnsupportedSport } from './wp-resolver.js';
// ...
} else {
  if (!isWpUnsupportedSport(pick.sport)) {
    await _recordWpResolutionFailure(this.env, pick.sport, pick.gameId, 'resolveWinProbability returned null');
  }
}
```

The `catch` block's `_recordWpResolutionFailure` call is unchanged, per the doc's
explicit instruction to verify rather than assume. Traced `resolveWinProbability`'s
control flow: `if (!s) return null;` (the unsupported-sport early exit) happens at
line 352, **before** the `try` block begins at line 356. An unsupported sport
therefore cannot structurally reach the `catch` block — a thrown exception is only
possible for a sport that already passed the unsupported check. No guard belongs
there, confirming the doc's reasoning rather than contradicting it.

## Verification

Wrote a real Node test (`/tmp/.../test-isWpUnsupportedSport.mjs`) that imports
`isWpUnsupportedSport` directly from the committed `src/wp-resolver.js` (not a
copy or a mock) and enumerates `SPORT_LABEL_MAP`'s actual keys from the source
file at test-run time (regex-extracted, not hand-copied), so the test would catch
a future change to the map.

```
Enumerated 15 null-mapped keys, 35 supported keys from committed source.

86 passed, 0 failed
```

Covered:
- **True** for every literal null-mapped key currently in `SPORT_LABEL_MAP` (15
  keys, both lowercase and uppercased), plus the doc's explicit list
  (`'golf'`, `'Golf'`, `'tennis'`, `'rugby'`, `'wwe/pro wrestling'`,
  `'ncaa basketball'`, `'formula 1'`, `'f1'`, `'racing'`, `'unknown'`)
- **False** for a sample of real supported labels (`'baseball (mlb)'`, `'mlb'`,
  `'nba'`, `'wnba'`, `'premier league'`, `'cfl'`, `'afl'`) plus all 35 non-null
  keys in the map (cross-checked, not just the sample)
- **False** for a genuinely unrecognized string (`'some new sport nobody has
  seen'`) — confirms the fallthrough case still isn't suppressed
- **False** for `null`/`undefined`/`''` input (defensive)

`node --check src/wp-resolver.js` and `node --check src/user-do.js` both pass.

### Repo test/smoke command — absence confirmed, not assumed

`package.json` has no `"scripts"` key at all — no `test` or `smoke` command
exists in this repo. Root-level `test-*.js` files exist (`test-wc-odds-complete.js`,
`test-germany-ecuador-calibration.js`, `test-germany-ecuador-fix.js`) but are ad
hoc one-off verification scripts for unrelated features, not a general test
runner. This absence is reported per the doc's instruction, not treated as a
blocker — the Node test above is the verification for this pure-function change.

## Scope Boundary (explicitly not done, per the doc)

This CC-CMD does **not** add a more granular failure reason for genuine
(case-1) resolution failures — e.g. distinguishing "no ESPN match found" from
"no winprobability data" from "fetch threw". `resolveWinProbability()`'s return
contract (a bare `null` on every failure path) is unchanged. That would require
a full caller audit first per Rule 13 and is intentionally out of scope here —
this fix only stops case-2 noise; it does not improve case-1 diagnostics.

## Confidence Score

```
+25  isWpUnsupportedSport correctly implemented; resolveWinProbability and
     normalizeSportCode byte-for-byte unchanged
+25  Both call sites probe-confirmed before editing (not edited from the
     doc's line numbers alone); only the else branch guarded — catch-block
     reasoning independently traced and confirmed (early-exit at line 352
     is before the try block at line 356, so unsupported sports cannot
     reach the catch), not assumed from the doc
+25  Node test passes all 4 required cases (86 assertions) against the
     real committed source; SPORT_LABEL_MAP enumerated at test-run time
     via regex extraction from the source file, not hand-copied
+15  Repo's actual scripts/test setup checked directly (package.json has
     no scripts key, no smoke runner exists) — absence honestly reported,
     not assumed or invented
+10  Outbox states the scope boundary explicitly: this stops case-2 noise
     only; granular case-1 failure-reason diagnostics remain deferred,
     not silently dropped
= 100/100
```

**Score: 100/100 — above 95 threshold.**
