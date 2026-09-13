# CC session — AmbientDO's swallowed alarm, and two CC-CMDs closing together

**Date:** 2026-09-13 UTC · **Repo:** field-relay-nba · **Branch:** `main` (`0d04e3f`)
**CC-CMDs CLOSED:** `catch-collapse-routes` · `ambient-do-setalarm-swallowed`

---

## The seven routes were already fixed, and unclosed

Verified at HEAD rather than trusted: `d1AllOrError(stmt, label)` returns
`{results, error}` with `results` **null** on failure — a sibling of the value,
not a member of it — and callers branch on `error`, never `results.length`. A
failed read answers HTTP 503 `{ok:false, error:'query_failed'}`. CONTRACTS.md
carries the shape and the verified consumer position: six of the seven routes
have no jubilant-bassoon consumer at all, and the seventh already branched on
`res.ok`.

Its done condition — zero unsuppressed `catch-collapse` under `src/` — read **1**,
and that one was `ambient-do.js:950`: a *different* CC-CMD, by this document's
own Rule 87.4 split. So the two close together.

## AmbientDO: what was actually wrong

```js
_scheduleAlarm(delayMs) { this.ctx.storage.setAlarm(Date.now() + delayMs).catch(() => {}); }
```

`alarm()`'s **only** re-arm is this method — line ~333, under its own comment
*"Always reschedule — never let the alarm die silently"*. A swallowed rejection
stops the cross-sport SSE poll with no log and no signal anywhere.

### Two corrections to the CC-CMD's own framing

Both from tracing at HEAD rather than repeating the document:

1. **"the DO never wakes again"** — not quite. The second `_scheduleAlarm` call
   site is the client-connect path (*"might be the first client today"*), so a
   new connection re-arms a dead instance. The damaging window is clients
   already connected, alarm dead, nobody new arriving: the DO looks alive and
   silently stops emitting. Real, and bounded by the next connect.
2. **"fix the class, not the instance"** — the class is one instance.
   `bracket-do.js` and `user-do.js` call `setAlarm` nowhere. `game-do.js` awaits
   it unguarded at `:403`/`:419`, so a rejection there **propagates** out of
   `alarm()` instead of vanishing. Loud, not silent — a different posture, and
   not changed here (Rule 69).

### The posture

Log the DO id and the delay, then retry **exactly once**. Bounded by a parameter
rather than a timer or a loop: the recursive call always passes `_isRetry` true,
so two attempts is the maximum by construction. The CC-CMD's warning was that
*"a tight retry loop inside a DO burns wall-clock on every tick"* — this cannot
loop.

## Three harness defects, each of which reported something false

A swallowed error and a handled one are indistinguishable from outside, so the
only test worth anything forces the rejection. Getting that test to be honest
took three corrections:

1. **The stub `this` lacked `_scheduleAlarm`.** The retry re-enters through it,
   so the retry path threw `TypeError` and the harness reported a *product*
   failure that was its own. The happy path alone had passed.
2. **Dropping the `_isRetry` guard made the check HANG, not fail.** Infinite
   recursion; the job stuck at 120s with the mutated file still on disk and the
   tree dirty. Two fixes: the storage stub stops rejecting after 50 attempts, so
   the assertion reports `got 50 attempt(s)` instead of spinning; and the
   mutation harness runs the check under a 20s timeout, reporting a hang as
   **caught-but-HUNG** rather than folding it into "caught" — a stuck job in CI
   is its own problem and must be visible as one.
3. **`logs.some(...)` was too weak.** Both log lines carry `delayMs`, so
   deleting it from the *first* line still passed. Mutation A4 read NOT CAUGHT
   until the assertions were split per-line. **An assertion over a collection
   proves something about the collection**, which is weaker than what it was
   meant to say.

Final: 11 assertions over 3 scenarios, 4 mutations, all caught on their named
case — including restoring `.catch(() => {})` exactly as it shipped.

## Done condition — both CC-CMDs

```
check-absence-collapse.mjs . --json
catch-collapse under src/ (unsuppressed): 0      (was 1)
suppressed total: 18
```

`ambient-do.js` is **clean, not suppressed**. The CC-CMD asked for that
explicitly: *"suppressing a known concern to make a count go down is the failure
this whole rule exists to prevent."*

Both checks wired into `deploy.yml`.

## Carried forward

Nothing from either. The 112 `catch-collapse` findings in probes, tests and
smoke harnesses remain deliberately out of scope — a test harness swallowing an
error into `[]` is a different risk and mostly a correct one.
