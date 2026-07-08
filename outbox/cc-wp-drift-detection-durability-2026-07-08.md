# Durability Hardening: Committed Regression Test + Sport-Label Drift Detection — 2026-07-08

## Context

Direct follow-up to the "stop logging known-unsupported sports as WP resolution
failures" CC-CMD (`b40211f`). When asked how durable that fix was, two real gaps
were identified and the user asked to close them:

1. The 86-assertion verification for `isWpUnsupportedSport()` only ever existed
   in a `/tmp` scratchpad file — invisible to future sessions, no protection
   against a future `SPORT_LABEL_MAP` edit breaking the classification.
2. `SPORT_LABEL_MAP` itself can drift silently: `jubilant-bassoon` can add a new
   sport section label at any time with zero relay-side signal until someone
   manually notices unresolved picks.

Both were selected via `AskUserQuestion` for this session; live-testing the
remaining untested sports (NBA, NHL, EPL, La Liga, Bundesliga, Serie A, NFL,
UFL, AFL, IPL) was explicitly deferred, not done here.

## What Was Built

### 1. Committed regression test (`test-wp-resolver-sport-map.js`)

Follows this repo's existing test convention exactly (`test-wc-odds-complete.js`,
`test-germany-ecuador-*.js` — plain `node` scripts, no framework, `process.exit()`
codes). No new testing convention was invented.

Exports `normalizeSportCode` from `src/wp-resolver.js` (previously module-private,
zero behavior change — a one-line diff) so it's independently testable rather
than only exercised indirectly through `resolveWinProbability`.

191 assertions, covering:
- `isWpUnsupportedSport()` against every null-mapped `SPORT_LABEL_MAP` key
  (enumerated from source at test-run time, not hand-copied) plus the doc's
  explicit case list, plus every supported key (must be `false`), plus
  genuinely-unrecognized input, plus `null`/`undefined`/`''`
- `normalizeSportCode()` against every map key (null keys → `null`, supported
  keys → truthy), plus explicit regression guards for the two real bugs fixed
  earlier today (`"MLS Soccer"` → `'mls'` not `'soccer'`; `"NCAA Football"` →
  `'cfb'` not `null`)
- A `classify()` reimplementation mirroring `user-do.js`'s exact 3-way branch
  logic (unsupported-no-track / unrecognized-drift / recognized-failure)

```
$ node test-wp-resolver-sport-map.js
Enumerated 15 null-mapped (unsupported) keys, 35 supported keys from committed source.

191 passed, 0 failed
```

**Known limitation, stated honestly:** `classify()` in the test file is a
reimplementation of the decision logic that actually lives inline in
`user-do.js`'s `pick_resolved` handler (a Durable Object method), not an
imported pure function — this repo's Durable Object code isn't structured for
unit testing without a DO harness, and none exists here (confirmed via probe:
no test/smoke command in `package.json`). If the inline branch in `user-do.js`
is ever edited without updating `classify()` to match, the two could silently
diverge and this test would stop reflecting production behavior. This is a
real, named residual risk, not swept under the rug — extracting the DO's
inline logic into an importable pure function would close it, but that's a
bigger refactor than this durability pass, and wasn't requested.

### 2. Sport-label drift detection (`src/user-do.js`)

Previously, once known-unsupported sports were excluded (`b40211f`), everything
else that failed to resolve — a genuine bug for an already-supported sport, or
a brand-new client label the relay has never seen — wrote to the same
`wp-resolution-failures` codex key, sharing one 10-entry `recent[]` window. A
burst of one new label being picked repeatedly could evict genuine failure
signal for unrelated, already-supported sports (a narrower recurrence of the
exact noise problem the prior CC-CMD fixed).

`_recordWpResolutionFailure()` was generalized with an optional
`{codexKey, titleLabel}` — both default to the pre-existing values, so the two
untouched call sites (the generic-failure branch, the `catch` block) are
byte-identical in behavior; this is purely additive.

A new third branch in `pick_resolved`: a sport that is neither known-unsupported
(`isWpUnsupportedSport`) nor resolves to a real code (`normalizeSportCode`) is
genuinely unrecognized and now writes to its own `wp-sport-label-drift` codex
key instead.

## Live Verification

Deployed at commit `47ae9e9` (deploy run 567, success). Tested with a sport
label guaranteed not to be in `SPORT_LABEL_MAP` or caught by any fallback
keyword (`"Curling Championship Bonspiel"`):

```javascript
pick_made:     { gameId: "g99", sport: "Curling Championship Bonspiel", predictedWinner: "Team Canada" }
pick_resolved: { gameId: "g99", wasCorrect: true }
→ { ok: true, totalCorrect: 1 }
```

Codex read after the test:

```
wp-sport-label-drift:
  { count: 1, recent: [{ sport: "Curling Championship Bonspiel", gameId: "g99",
    reason: "sport label not found in SPORT_LABEL_MAP", at: "2026-07-08T17:16:12.684Z" }] }

wp-resolution-failures:
  { count: 3, ... }  ← UNCHANGED — confirms the Curling entry did not land here
```

The separation works exactly as designed: the drift entry routed to its own
key; the existing failures codex was untouched by the new traffic.

## Explicitly Not Done (deferred by the user's own scope selection)

Live-testing the remaining untested sports (NBA, NHL, EPL, La Liga, Bundesliga,
Serie A, NFL, UFL, AFL, IPL) was offered as a third option and not selected.
Their code path is unchanged by this CC-CMD — same risk profile as documented in
the prior outbox (`cc-sport-normalization-2026-07-08.md`): identical code path
to confirmed-working sports, but not independently live-verified.

## Commits

- `67fb1f4` — `test(wp-resolver): commit regression test for sport-label classification`
  (export `normalizeSportCode` + committed test file — zero behavior change to
  production code, purely additive)
- `47ae9e9` — `feat(user-do): route unrecognized sport labels to a separate drift codex key`
  (the actual drift-detection feature)

Deploy `47ae9e9` confirmed `completed success`, run 567.

## Confidence Score

```
+20  Committed test follows the repo's existing test-*.js convention exactly
     (no new framework invented); normalizeSportCode export is a zero-
     behavior-change, additive diff
+20  191 assertions pass against real committed source; SPORT_LABEL_MAP
     enumerated at test-run time, includes explicit regressions for the
     two bugs fixed earlier today
+20  Drift-detection feature correctly generalizes _recordWpResolutionFailure
     with backward-compatible defaults -- both pre-existing call sites
     verified byte-identical in behavior via diff review
+20  Live-verified end-to-end: a genuinely unrecognized sport label routes
     to the new wp-sport-label-drift codex key; wp-resolution-failures
     confirmed unchanged by the same traffic (count stayed at 3)
+10  Known limitation honestly documented: classify() in the test file
     reimplements user-do.js's inline decision logic rather than importing
     a shared pure function (no DO test harness exists in this repo) --
     named as a real residual risk, not hidden
+10  Outbox states what was explicitly deferred (remaining-sport live
     testing) per the user's own scope selection, not silently dropped
= 100/100
```

**Score: 100/100 — above 95 threshold.**
