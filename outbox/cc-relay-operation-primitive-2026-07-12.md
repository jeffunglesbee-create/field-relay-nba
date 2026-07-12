# relayOperation() primitive — 2026-07-12

## TASK 0 — Probe re-confirmed, existing-store check

```
$ grep -n "return null;" src/index.js | wc -l          -> 59  (doc cited 59, no drift)
$ grep -cE "\.catch\(\s*\(?_?\)?\s*=>\s*\{" src/index.js -> 12  (doc cited 12, no drift)
$ grep -cE "catch\s*\([^)]*\)\s*\{\s*(/\*.*\*/\s*)?\}" src/index.js -> 115 (doc cited 115, no drift)
```

**Existing-telemetry-store check, per the doc's explicit instruction** —
found a real, relevant hit: `captureFieldError` is referenced once, at the
`push-send` catch block (was line 4017-4018 pre-edit):
```js
} catch(e) {
    if (typeof captureFieldError === 'function')
        captureFieldError('push-send', e.message);
}
```
Investigated rather than assumed live: `grep -n "function captureFieldError\|captureFieldError ="`
across every `src/*.js` file returns **zero** definitions or imports anywhere
in this repo. `captureFieldError` is an undeclared identifier — the
`typeof captureFieldError === 'function'` guard means this branch can
never execute (`typeof` on an undeclared identifier safely evaluates to
`'undefined'`, never throws, but never calls anything either). This is
vestigial — almost certainly copy-pasted from jubilant-bassoon's real
client-side `captureFieldError()` global without ever being wired
server-side. Confirms the doc's own CONTEXT claim ("no existing
relay-side telemetry store to extend") is correct: this is not a store to
extend, it's dead code that happens to look like one. Left untouched —
fixing/removing it is a different, unrequested change (Rule 69); flagged
here as a real, genuine finding rather than silently worked around.

## TASK 1 — `relayOperation()` / `RELAY_OPERATIONS`

Added to `src/index.js`, immediately after the import block (before the
"Repo source access" section) — a natural top-level-helper location
matching this file's existing convention of module-level pure functions.
Code is unmodified from the doc's own TASK 1 sample (only a comment block
added explaining the `captureFieldError` finding and Rule 47 framing).

`swallow` is a documentation-only marker at the call-site level — the
function body never branches on it (`void swallow;` makes this explicit);
both the `swallow:true` and default paths return the identical
`{ok:false, subsystem, operation, retryable, context, error, at}` shape.

**Only `src/index.js` was touched.** `src/game-do.js` was left unchanged:
the DONE CONDITION explicitly defers migrating GameDO's two fire-and-forget
calls to a separate CC-CMD, and nothing in game-do.js currently needs to
call this primitive yet — adding an unused copy there would be exactly the
kind of no-consumer dead code Rule 63 prohibits. The "Scope" line naming
both files is read as pre-authorizing either file if needed, not mandating
a change to both; `node --check src/game-do.js` was still run per TASK 2,
confirmed clean and confirmed via `git diff --stat -- src/game-do.js`
(empty output) that it is byte-identical to before.

## TASK 2 — Verification

`node --check src/index.js` — clean.
`node --check src/game-do.js` — clean (file untouched).

**Unit-level, both paths, run for real** (temporary standalone script,
exact copy of the added logic — pure JS, no Workers bindings needed —
deleted immediately after, confirmed via a fresh `git status` that no
temp file was left behind):

```
SUCCESS CASE: {"ok":true,"value":42}
FAILURE CASE: {"ok":false,"subsystem":"test","operation":"fail","retryable":true,"context":{"gameId":"X"},"error":"boom","at":1783898234037}
SWALLOW CASE: {"ok":false,"subsystem":"test","operation":"fail-swallowed","retryable":false,"context":{},"error":"boom2","at":1783898234037}
ALL ASSERTIONS PASSED
```
Confirmed: success path returns `{ok:true, value}` with no `error` field;
failure path returns the full typed failure shape with `subsystem`,
`operation`, `retryable`, `context`, `error`, `at` all correctly threaded
through from the call site; `swallow:true` returns the identical shape to
the default case (proving it's a marker, not a second code path), and
still calls `RELAY_OPERATIONS.recordFailure` (visible in the captured
`console.error` JSON line) so the failure remains observable even for a
"fire-and-forget" caller.

`git diff --stat` after the edit: `src/index.js | 29 +++++++++++++++++++++++++++++`
— pure addition, zero existing lines modified, matching "Zero existing
call sites touched."

## DONE CONDITION

Met: `relayOperation()`/`RELAY_OPERATIONS` exist in `src/index.js`,
shape-consistent with jubilant-bassoon's `fieldOperation()`, unit-verified
for both the succeeding and throwing paths plus the `swallow` marker.
Zero existing call sites modified. GameDO's two fire-and-forget calls
remain untouched, explicitly deferred to a future, separate CC-CMD.

## Confidence Score

```
+20  TASK 0 re-confirmed all 3 counts with zero drift; found and
     investigated captureFieldError (confirmed via grep across every
     src/*.js file that it's an undefined global, not a real store)
     rather than assuming the doc's "no existing store" claim
+25  relayOperation() shape exactly matches jubilant-bassoon's
     fieldOperation() pattern per the doc's own spec
+20  swallow correctly implemented as a call-site documentation marker
     only -- one code path, proven via the unit test's SWALLOW CASE
     returning the identical shape to the default FAILURE CASE
+20  Zero existing call sites touched -- confirmed via git diff (pure
     29-line addition) and git diff --stat -- src/game-do.js (empty,
     untouched)
+15  Both node --check clean; unit-level proof of both success and
     failure paths run for real (temporary script, deleted after,
     confirmed no residue via git status)
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `cf01565` — the primitive: `relayOperation()`/`RELAY_OPERATIONS` added
  to `src/index.js`, zero existing call sites touched
- (this commit) — this outbox, written after real unit-level verification
