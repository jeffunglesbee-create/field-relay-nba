# Claude Code Command — the slate gate has a twin one loop later

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (gap) — the same defect, a third site
**Status:** FILED, not started.

**Second CC-CMD per Rule 87.4**, opened rather than widening
`docs/CC-CMD-2026-08-25-golf-slate-line.md`, whose ask names `gameLines` only.

## The measurement

`buildGameLine` has **two** callers. That document discusses one.

```
src/index.js:8470   the slate walk        for (const {sport,league,label,individual} of LEAGUES)
src/index.js:9383   per-game brief enqueue  for (const {sport, league, label} of LEAGUES)
```

The second loop head **does not destructure `individual`**, and nothing
downstream guards on it — the 50 lines after the call were searched for
`individual`, a `continue`, or an empty-name check, and the only hit is an
unrelated `broadcast` line.

So on a golf day that loop enqueues a per-game brief whose `gameLine` is, as
measured live on 2026-10-11 (run `38142889937`,
`outbox/golf-slate-line-probe-latest.json`):

```
-15 @ -16 · Final · Golf Chnl
```

with `homeName` and `awayName` both `''`, because golf competitors carry
`athlete` rather than `team` and `homeAway` is null on all 72 of them.

## Why this is the same shape as the archive defect, not a new one

The golf-sport-label CC-CMD fixed a **double row**: the same event archived
once correctly by the golf-aware `[GOLF-BRIEF]` path and once wrongly by the
generic catch-up. This is the brief equivalent. `[GOLF-BRIEF]` already enqueues
a per-round golf brief from `golfData` at ~8930, so a golf day would produce
**two briefs for one event** — one correct, one about two nameless sides.

**That is unverified.** It is read from source, exactly as the slate defect was
before it was probed, and the probe then found the real line was worse than
predicted. Probe before writing.

## Tasks

**Task 1 — probe, do not trust the paragraph above.** On a golf day, establish
whether the per-game enqueue actually fires for the golf event: does it reach
`JOURNALISM_QUEUE`, and does a `brief:game:<id>` key appear for a golf event id
alongside the `[GOLF-BRIEF]` one? The artifact is the two KV keys, or evidence
that only one exists. **If only the golf-aware brief exists, this document
closes as WITHDRAWN** — something upstream already filters it and the reason
should be recorded.

**Task 2 — if it fires, destructure and gate.** `individual` into the 9383 loop
head and `if (individual) continue;` before its fetch, the same shape as the
slate gate. Do NOT reuse the slate loop's gate position argument blindly —
re-read what that loop pushes before choosing where the gate goes.

**Task 3 — extend the guard, do not add a sibling.**
`scripts/check-individual-sports-not-archived.mjs` already carries
`slateGateState` and `gateState`. A third state function belongs beside them,
and its self-test must break each link on its own: a gate with no destructure
reads `undefined` and passes everything, which is the failure the existing
`carried`/`destructured` pair was written for.

**Task 4 — count the callers, as a ratchet.** `buildGameLine` has two callers
today. Assert that number. A third caller added without a flag is this same bug
again, and the only reason this one was found is that someone grepped for
callers rather than trusting a document.

## Stop conditions

- Do not change `buildGameLine` itself. Making it golf-aware would put
  individual-sport formatting into the function every team sport uses; the
  `[GOLF-BRIEF]` path already exists and is correct.
- Do not remove the `[GOLF-BRIEF]` enqueue to resolve a duplicate. It is the
  correct one.
- If Task 1 cannot run because no tournament is live, STOP and schedule it.
  A green deploy is not evidence here.

## Done conditions

1. Task 1's artifact: the KV keys present for a golf event id on a golf day, or
   proof the enqueue never fires.
2. If it fires: the gate exists, with `individual` destructured in that loop.
3. A guard assertion that breaks when either link is removed on its own.
4. `buildGameLine`'s caller count is asserted.
