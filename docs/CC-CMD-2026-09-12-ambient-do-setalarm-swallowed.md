# CC-CMD-2026-09-12 — AmbientDO swallows its own alarm failure

Rule 87.4 successor, raised while closing
`CC-CMD-2026-09-12-catch-collapse-routes`. Not fixed there because it is a
different rule and a riskier change.

## The finding

`src/ambient-do.js`:

```js
_scheduleAlarm(delayMs) {
    this.ctx.storage.setAlarm(Date.now() + delayMs).catch(() => {});
}
```

If `setAlarm` rejects, the Durable Object **never wakes again**. There is no
retry, no log, and no signal anywhere that the heartbeat stopped. AmbientDO's
alarm drives the cross-sport SSE ping and the reconnect cadence, so the failure
mode is a DO that looks alive — clients still connected — and silently stops
emitting.

This is **not** a Rule 99 absence collapse: no value is decoded into a
too-narrow type. It is an ignored error on a durability-critical path. The
absence-collapse census matched it because the syntax is the same, which is why
it is filed rather than swept into that change.

## Why it was not fixed inline

Changing DO alarm behaviour touches the liveness of every connected client
(STANDARDS Rule 24, execution path contracts). A retry that is wrong is worse
than the current silence: a tight retry loop inside a DO burns wall-clock on
every tick.

## Tasks

0. **Probe.** Read `_scheduleAlarm`'s call sites and say, for each, what the
   cadence is and what stops if the alarm never fires. Then check whether
   `alarm()` itself re-schedules — if it does, one swallowed failure is
   terminal for that DO instance, and that is the sentence to verify, not
   assume.

1. **Decide the failure posture.** At minimum the rejection must be logged with
   the DO id and the delay. Whether it also retries, and with what backoff, is
   the decision this CC-CMD exists to make — do not add a retry without stating
   what bounds it.

2. **Check the siblings.** `bracket-do.js`, `game-do.js` and `user-do.js` — does
   any of them schedule an alarm the same way? Fix the class, not the instance.

3. **Mutate (Rule 90).** Force `setAlarm` to reject and assert the chosen
   behaviour actually happens. A swallowed error and a handled one look
   identical from outside; only a forced rejection tells them apart.

4. **Done condition.** `scripts/check-absence-collapse.mjs` reports
   `ambient-do.js` either clean or suppressed with a reason naming this
   decision. It is deliberately left FLAGGED until then — suppressing a known
   concern to make a count go down is the failure this whole rule exists to
   prevent.
