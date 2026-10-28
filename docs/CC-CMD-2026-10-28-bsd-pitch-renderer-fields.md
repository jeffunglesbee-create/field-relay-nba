# Claude Code Command — the client's BSD pitch reads fields the feed does not carry

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** jubilant-bassoon executes it (`src/legacy/field.js` only; never `index.html`'s script block). The relay side is already declared and deployed.
**Filed:** 2026-10-28, by CC, from `docs/CC-CMD-2026-10-28-bsd-ws-top-flight-sample.md` Task 3
**Status:** FILED, not started. Blocked by: nothing that waits on a person. Needs one measurement first (Task 0).

---

## Related, read before building (BUILD-ON-A)

Searched 2026-10-28 by content (`_bsdBallPos`, `_bsdRepaint`, `bsd-pitch`, `_bsdShotData`) in `docs/CC-CMD-*.md`
of field-relay-nba and field-laboratory, and `docs/` of jubilant-bassoon.

- `field-relay-nba/docs/CC-CMD-2026-06-25-G-jb-pitch-component.md`: built the component against the spec's
  guessed payload. This changes what it reads; it removes none of what it ruled on.
- `field-relay-nba/docs/CC-CMD-2026-10-28-bsd-ws-fanout-field-names.md` (DONE): the relay payload, now proven
  through the deployed relay.
- `field-relay-nba/docs/CC-CMD-2026-10-28-bsd-ws-top-flight-sample.md` Task 3: pointed at the client edit; that
  edit lives here instead.

## What was measured (Rule 73)

2026-10-28, by reading jubilant-bassoon `src/legacy/field.js` (function `_bsdRepaint`, near line 33491) against
payloads recorded from the deployed feed (`field-relay-nba/outbox/bsd-ws-frames-*.jsonl`, three matches):

1. **Ball.** `_bsdOnSSEFrame('bsd:ball', data)` stores `_bsdBallPos = data`; `_bsdRepaint` draws a dot only when
   `_bsdBallPos.x != null`, at `x`/`y`. The relay's `bsd:ball` has no `x` or `y`: the position is nested at
   `data.coords = { x, y }` or `null`. So no ball has ever drawn, whatever the feed carries.
2. **Which frames carry a position.** 101 of 161 recorded livedata frames carry four points, 18 carry one, 42
   carry none (all 14 of event 602466, which streams but has an empty window, and 28 of the 147 DFB Pokal
   frames). `_bsdBallPos = data` on EVERY frame would blank the dot on each frame without a point.
3. **Shots.** `_bsdRepaint` plots each `_bsdShotData` entry from `s.x`, `s.y`, `s.team` and `s.xg`. The relay's
   own `/bsd/contract` `frameShapes.shot` declares a record with `pos{x,y,z}`, `home`, `xg` and no top-level `x`,
   `y` or `team`, and says `pos` is target-goal-relative per team. Read from the code and the contract, not
   rendered.
4. **Where it runs.** `_bsdActivate` is called from the game detail view (`bsd-pitch` section, around line 33352)
   for any live game that carries a `bsdEventId`, and from the WC tab. The relay now writes `bsd_event_id` onto
   archived soccer rows (`field-relay-nba/docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`, DONE), so reach is
   about to grow.

## Task 0 — probe (run first, against current HEAD)

```bash
git log --oneline -5
grep -n "_bsdBallPos\|_bsdShotData\|_bsdRepaint\|_bsdOnSSEFrame" src/legacy/field.js
grep -n "bsd-pitch\|_bsdActivate(" src/legacy/field.js
```

Then MEASURE, from `field-relay-nba/outbox/bsd-ws-frames-6023*-*.jsonl` (read-only; do not copy them in):

- the gap in seconds between consecutive frames that carry a point (median and 90th percentile), so a
  "how old may the dot be" threshold is a measured number, not a guess;
- the second-half frame of reference: a `goal_kick` by each side in the same half, `x` near 5 or near 95. The
  first half is measured (home defends x=0); if a capture of the second half is not in the outbox, run
  `bsd-ws-capture.yml` during a live `live_websocket` second half first.

## Task 1 — the ball

In `_bsdOnSSEFrame` and `_bsdRepaint` only:

1. Read the position from `data.coords` (`{x, y}`), and keep the previous position when a frame carries none.
2. Drop a position older than the Task 0 threshold; do not invent one.
3. Use the frame of reference Task 0 established. If the second half differs from the first, say so in the code
   comment and handle it from the frame's own `time.period`; if it could not be measured, leave the dot off in
   the second half rather than draw it mirrored. Nothing here is computed from the feed: it is only placed.

## Task 2 — the shots (separate commit)

Plot from `pos` and `home`, applying the contract's `transformReference.mirrorAway` to away shots so both teams
share one pitch. The source of the formula is the served `/bsd/contract`; copy it, do not retype it from memory.

## Verification (jubilant-bassoon Rule 90, CI-as-proxy Playwright; an artifact, not "looks right")

A workflow `bsd-pitch-probe.yml`, triggered by an `outbox/.trigger-*` push, loads the DEPLOYED page in a real
browser, creates a `#bsd-pitch` element, feeds `_bsdOnSSEFrame` a recorded `bsd:ball` payload (verbatim from the
relay's `frameShapes.livedata.example`) and a recorded shot record, calls `_bsdRepaint`, and commits a
screenshot plus a manifest of booleans: `ballCircleFinite`, `ballCx`, `ballCy`, `ballKeptOnNullFrame`,
`shotCirclesFinite`, `nanAttributes: 0`. Expected values are computed from the payload in the manifest itself.
This proves the reader, not a live match; say so in the artifact.

## Done conditions

1. The manifest exists on main and every boolean above is true, with `nanAttributes` equal to 0.
2. `node smoke.js index.html` shows 0 failed, SW_VERSION bumped in `index.html` and `sw.js` and equal.
3. The Task 0 numbers (gap median and p90, second-half frame) are in the commit message and the session doc.
4. `field-relay-nba/CONTRACTS.md` "Known mismatch (STAGED)" line for `bsd:ball` is replaced by what shipped,
   in both repos' copies.
