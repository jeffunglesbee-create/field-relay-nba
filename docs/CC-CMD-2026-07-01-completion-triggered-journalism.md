# Claude Code Command — Trigger Journalism on Game Completion

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-completion-triggered-journalism-2026-07-01.md.

## CONTEXT

`game-do.js`'s existing state-transition detector
(`facts.state === 'final' && prevState !== 'final'`, ~line 383) already
fires an immediate, deduped archive write with zero user present — real,
confirmed live tonight. It does NOT also dispatch to `JOURNALISM_QUEUE`.
Brief generation for a just-finished game still waits for the next
scheduled cron tick, which can mean a real delay (e.g. a game ending at
12:47am with the next cron at a fixed schedule time). This is the one
remaining piece of the "active intelligence" gap identified in an
earlier session (2026-06-07): scheduled self-correction and live
WebSocket fan-out are both confirmed real; completion-triggered
*journalism* specifically is not yet wired, only completion-triggered
*archival*.

**RUWT/RELAY-IS-DUMB compliance note:** dispatching "a game just ended,
generate its brief" is a pure fact-forwarding signal, not an editorial
or scoring decision — GameDO doesn't decide what the brief says or how
interesting the game was, it only signals that a real state transition
occurred. This is architecturally the same class of action as the
existing archive-write hook, not a new category of relay responsibility.

## PRE-BUILD PROBE (Rule 87)

```bash
sed -n '1,90p' src/game-do.js
sed -n '370,420p' src/game-do.js
grep -n "this\.env\." src/game-do.js
```

**Critical, must-verify-not-assume step:** confirm whether `this.env`
inside `GameDO` actually includes the `JOURNALISM_QUEUE` binding
directly (check the constructor and any other `this.env.X` usage already
present — e.g. `this.env.RELAY_BASE` is confirmed used, but that doesn't
guarantee `JOURNALISM_QUEUE` is bound to the same scope). If direct
access is NOT confirmed available, use the SAME indirect pattern the
archive write already uses (fire-and-forget POST to a new or existing
relay endpoint that itself calls `env.JOURNALISM_QUEUE.send()`) rather
than assuming direct binding access works. Do not guess — the probe
step must settle this before Task 1 is written.

## TASK 1: Dispatch journalism generation on the same transition, using whichever access pattern the probe confirmed

**If direct binding access is confirmed:**

```javascript
if (facts.state === 'final' && prevState !== 'final') {
    try {
        const already = await this.ctx.storage.get('archived');
        if (!already) {
            await this.ctx.storage.put('archived', Date.now());
            // ... existing archive fetch, unchanged ...

            // NEW: fire journalism generation immediately, don't wait for cron.
            try {
                await this.env.JOURNALISM_QUEUE.send({
                    type: 'game-recap',
                    sport: this.sport,
                    gameId: this.gameId,
                    source: 'completion-trigger',
                });
            } catch (_) { /* queue dispatch failure cannot affect DO — same fire-and-forget discipline as the archive write */ }
        }
    } catch (_) { /* archive hook failure cannot affect DO */ }
}
```

**If indirect HTTP relay is required instead**, follow the exact
fire-and-forget pattern already used for `/archive/game` — a new
relay-side endpoint (or extending an existing one) that receives the
completion signal and calls `env.JOURNALISM_QUEUE.send()` from the main
Worker's scope, not from inside the DO.

Match the exact job `type`/shape already expected by the queue consumer
(grep `env.JOURNALISM_QUEUE.send(` call sites elsewhere in `index.js`
for the real, current message shape — do not invent a new shape that
the consumer doesn't already handle).

**Dedup already exists and should be reused, not duplicated** — the
same `archived` storage flag that gates the archive write should also
gate this, so a single completion event doesn't double-dispatch if the
DO receives a duplicate poll.

## TASK 2: Verification

```bash
node -c src/game-do.js
```

This cannot be fully verified live from the CC sandbox (no way to
simulate a real game reaching `state: 'final'` and observe the queue
consumer picking it up). Done condition for CC: syntax valid, the
dispatch call matches the real, currently-used message shape (confirmed
via probe, not assumed), and the existing archive-write behavior is
provably unchanged (same dedup flag, same fire-and-forget error
handling, no new failure mode introduced into the DO's primary fan-out
path).

**Chat-side follow-up (not checkable by CC):** watch for the next real
game completion and confirm a brief generates without waiting for the
next scheduled cron tick — the actual proof this works, since CC cannot
observe it end-to-end from the sandbox.

## TASK 3: Outbox manifest (last task)

State explicitly which access pattern (direct binding vs. indirect
HTTP) was actually used and why, based on what the probe found — this
is the one piece of this CC-CMD that couldn't be pre-decided and had to
be resolved against real code.
