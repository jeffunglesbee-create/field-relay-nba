# CC-CMD: Stop logging known-unsupported sports as WP resolution failures

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

`wp-resolution-failures` (codex, category `incident`) currently logs every
null return from `resolveWinProbability()` as a failure, with no
distinction between two structurally different cases:

1. **Genuine resolution failure** for a sport with a real, confirmed data
   source (MLB, NBA, WNBA, AFL, soccer, or anything in
   `ARCHIVE_SPORT_TO_ODDS_KEY`) — an actual bug worth investigating.
2. **Correctly unsupported sport** (Golf, Tennis, Rugby, WWE, NCAA
   Basketball, Formula 1, Racing, UEFA/EFL competitions, `Unknown`) —
   `SPORT_LABEL_MAP` maps these to `null` on purpose (`src/wp-resolver.js`
   comment: "correctly unsupported, not a gap"). This will recur forever,
   permanently and expectedly, for every pick made on these sports.

Verified live via direct D1 query (2026-07-08) that all 3 entries in the
current `wp-resolution-failures` incident are already fully explained:
2 were genuine bugs that are already fixed (predate the sport-label-map
fix and the pre-game-filter fix), 1 (Golf) is case 2 above. Going
forward, case-2 noise will bury any future case-1 signal under expected,
non-actionable entries.

**Explicitly out of scope for this CC-CMD:** adding a more granular
failure *reason* (e.g. distinguishing "no ESPN match found" from "no
winprobability data" from "fetch threw") for genuine case-1 failures.
That requires changing `resolveWinProbability()`'s return contract
(currently a bare `null` on any failure path), which needs a full
caller audit first (Rule 13) — not bundled into this fix. This CC-CMD
only stops case-2 noise; it does not improve case-1 diagnostics.

## PROBE BLOCK (Rule 87 — run before any edits)

```bash
git log --oneline -5
# Confirm current HEAD matches what this doc assumes; if not, re-read
# the relevant files below before proceeding rather than trusting this
# doc's line numbers.

grep -n "const SPORT_LABEL_MAP = {" src/wp-resolver.js
# Expected: found, single declaration, module-level.

grep -n "^function normalizeSportCode" src/wp-resolver.js
# Expected: found, takes `sport`, returns SPORT_LABEL_MAP[raw] on exact
# match or a fallback substring match; both paths return real codes,
# never null, except the explicit null entries in the map and the final
# genuinely-unrecognized fallthrough.

grep -n "^export async function resolveWinProbability" src/wp-resolver.js
# Expected: found. Confirm nothing already exports isWpUnsupportedSport
# or SPORT_LABEL_MAP — this task adds a new export, should not collide.
grep -n "isWpUnsupportedSport" src/wp-resolver.js src/user-do.js
# Expected: zero matches (confirms this is genuinely new, not a repeat).

grep -n "_recordWpResolutionFailure" src/user-do.js
# Expected: 3 hits — the two call sites (the `else` branch after a null
# `wp`, and the `catch` block) plus the function definition itself.

grep -n "^import.*wp-resolver" src/user-do.js
# Expected: `import { resolveWinProbability } from './wp-resolver.js';`
# — confirms only resolveWinProbability is currently imported.

# Confirm how this repo actually runs its own tests/smoke — do NOT
# assume the client repo's `node smoke.js index.html` pattern applies
# here; this is a different repo.
cat package.json | grep -A5 '"scripts"'
ls *.test.js *smoke*.js 2>/dev/null
```

If any probe contradicts what's described above, STOP and report the
actual state rather than proceeding on this doc's assumption.

## TASK 1 — Export a single-source-of-truth unsupported-sport check

In `src/wp-resolver.js`, after `normalizeSportCode()`'s definition, add:

```javascript
// Returns true only when `sport` is a real, known client label that
// SPORT_LABEL_MAP explicitly maps to null — i.e. a sport with genuinely
// no win-probability data source (Golf, Tennis, etc.), confirmed
// correct-and-expected behavior, not a bug.
//
// Deliberately does NOT reuse normalizeSportCode()'s fallback substring
// matching: every fallback branch in that function returns a real
// supported code, never null, so an exact-match-only check here is
// sufficient and avoids re-implementing that logic. A label that matches
// nothing at all (genuinely new/unrecognized) correctly returns false
// here, so it still surfaces as a failure rather than being silently
// swallowed — preserving normalizeSportCode's own stated purpose for
// that fallthrough case.
export function isWpUnsupportedSport(sport) {
    if (!sport) return false;
    const raw = String(sport).toLowerCase().trim();
    return Object.prototype.hasOwnProperty.call(SPORT_LABEL_MAP, raw)
        && SPORT_LABEL_MAP[raw] === null;
}
```

Do not modify `resolveWinProbability()` or `normalizeSportCode()` — this
is a pure addition, zero risk to either function's existing contract or
callers.

## TASK 2 — Guard both failure-recording call sites

In `src/user-do.js`:

1. Update the import (probe confirmed the exact current line):
```javascript
import { resolveWinProbability, isWpUnsupportedSport } from './wp-resolver.js';
```

2. At the `else` branch (probe-confirmed location, after `if (wp) {...}`):
   wrap the existing `_recordWpResolutionFailure` call so it's skipped
   for known-unsupported sports:
```javascript
} else {
  if (!isWpUnsupportedSport(pick.sport)) {
    await _recordWpResolutionFailure(this.env, pick.sport, pick.gameId, 'resolveWinProbability returned null');
  }
}
```

3. Leave the `catch` block's `_recordWpResolutionFailure` call
   **unchanged** — a thrown exception during resolution is never
   expected behavior regardless of sport (a Golf pick should return
   `null` cleanly via the `if (!s) return null;` early-exit, never
   throw), so no guard belongs there. Confirm this reasoning holds by
   reading `resolveWinProbability`'s actual control flow during the
   probe step before implementing — if a legitimate case exists where
   an unsupported sport could throw rather than return null cleanly,
   report that finding instead of silently guarding the catch block too.

## TASK 3 — Verification

Write a real Node test (not assumed passing) that imports
`isWpUnsupportedSport` from the actual committed `src/wp-resolver.js`
and asserts:
- Returns `true` for: `'golf'`, `'Golf'`, `'tennis'`, `'rugby'`,
  `'wwe/pro wrestling'`, `'ncaa basketball'`, `'formula 1'`, `'f1'`,
  `'racing'`, `'unknown'` (every literal null-mapped key currently in
  `SPORT_LABEL_MAP` — enumerate the actual map at test-run time, don't
  hand-copy this list, in case it's changed since this doc was written).
- Returns `false` for: `'baseball (mlb)'`, `'mlb'`, `'nba'`, `'wnba'`,
  `'premier league'`, `'cfl'`, `'afl'` (a sample of real supported
  labels).
- Returns `false` for a genuinely unrecognized string
  (`'some new sport nobody has seen'`) — confirms the fallthrough case
  still isn't suppressed.
- Returns `false` for `null`/`undefined`/`''` input (defensive).

Run whatever this repo's actual test/smoke command is (per the probe
step — do not assume `node smoke.js`). If none exists, that's a real
finding to report, not a blocker — the Node test above is sufficient
verification for this pure-function change.

## DONE CONDITIONS

- [x] Probe block confirms current state before editing
- [x] `isWpUnsupportedSport` exported from `wp-resolver.js`, zero
      changes to `resolveWinProbability`/`normalizeSportCode`
- [x] Both call sites in `user-do.js` probe-confirmed before editing
      (not edited from this doc's line numbers alone)
- [x] Only the `else`-branch call site is guarded; catch-block reasoning
      explicitly confirmed or contradicted during probe
- [x] Real Node test written and passing against actual committed
      source, covering all 4 cases above
- [x] Repo's actual test/smoke command run (or absence reported)
- [x] Outbox manifest written (this CC-CMD's completion report)

## CONFIDENCE SCORING

- +25 — `isWpUnsupportedSport` correctly implemented, zero changes to
  existing function contracts: **met if true**
- +25 — both call sites probe-confirmed and correctly guarded (only the
  `else` branch, not `catch`, unless probe found a real reason
  otherwise): **met if true**
- +25 — Node test passes all 4 cases against real committed source,
  map enumerated at test-run time not hand-copied: **met if true**
- +15 — repo's own test/smoke command run and passing (or absence
  honestly reported): **met if true**
- +10 — outbox correctly states this fix's scope boundary (noise
  suppression only, granular reason explicitly deferred, not silently
  dropped): **met if true**

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-wp-failure-noise-suppression.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
