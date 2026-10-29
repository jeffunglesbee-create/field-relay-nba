# Claude Code Command — the BSD pitch plots to the canvas edge but draws its lines 5% inside it

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** jubilant-bassoon executes it (`src/legacy/field.js` only; never `index.html`'s script block)
**Filed:** 2026-10-29, by CC, found while verifying `docs/CC-CMD-2026-10-28-bsd-pitch-renderer-fields.md`
**Status:** DONE 2026-10-29, the recommended option (map INTO the inset rectangle, keep the margin). Renderer jubilant-bassoon `8d0496e`
(SW 2026-10-29a, smoke 1066 / 0 failed, deploy gate run 40906714683); probe `70a5228`; proof: the committed manifest
`jubilant-bassoon/outbox/bsd-pitch-probe-manifest-2026-10-29T16-03-02.json` (run 40907485456, green again at 16:00:44, run 40907094464)
and its screenshot. Session doc: `outbox/cc-session-2026-10-29-bsd-pitch-renderer.md` (Part 2).

---

## Related, read before building (BUILD-ON-A)

Searched 2026-10-29 by content (`inset`, `0.05`, `pitch markings`, `bsd-pitch`, `_bsdRepaint`) in `docs/CC-CMD-*.md`
of field-relay-nba. Only these touch the renderer, and none rules on the geometry:

- `docs/CC-CMD-2026-10-28-bsd-pitch-renderer-fields.md` (DONE with this filing): fixed WHAT the renderer reads. It
  left the geometry alone on purpose and its probe asserts the existing mapping `cx = x * W / 100`.
- `docs/CC-CMD-2026-06-25-G-jb-pitch-component.md`: built the component and its `toScreenSVG`
  (`cx = x * w / 100; cy = (100 - y) * h / 100`), which assumes the pitch fills the canvas.

## What was measured (Rule 73)

2026-10-29, by reading the committed probe screenshot `outbox/bsd-pitch-probe-*.png` (jubilant-bassoon, written by
`bsd-pitch-probe.yml` against the deployed page) and `_bsdRepaint`:

1. The pitch lines (touchline and goal-line rectangle, halfway line) are drawn at `x = W * 0.05 .. W * 0.95` and
   `y = H * 0.05 .. H * 0.95`. Everything plotted uses `x * W / 100` and `(100 - y) * H / 100`, the full canvas.
2. So pitch x = 0 (the goal line) is plotted at the canvas edge, 5% OUTSIDE the drawn goal line, and pitch x = 5 is
   plotted ON it. The recorded away goal in event 602347 (min 43, shared pitch `x = 2.7`) lands at 9.7 px on a
   360 px canvas: outside the goal line (18 px) and cut by the canvas edge (its radius is 9.8 px, xg 0.676).
3. The same applies to the ball: a goal kick at `x = 5` is drawn on the goal line, not 5% of the pitch inside it.

## Task 0 — probe (run first, against current HEAD)

```bash
git log --oneline -5
grep -n "W \* \.05\|H \* \.05\|\* W / 100\|\* H / 100" src/legacy/field.js
ls outbox/bsd-pitch-probe-manifest-latest.json && node -e "const m=require('./outbox/bsd-pitch-probe-manifest-latest.json');console.log(m.pitchPx,m.homeShotCircle,m.awayShotCircle,m.ballCx,m.ballCy)"
```

## Task 1 — one mapping for lines, ball and shots

**Recommendation:** map pitch coordinates INTO the drawn rectangle, keep the 5% margin (it is what stops a large
circle at the goal line being clipped by the canvas):

```
cx = W * (0.05 + 0.9 * x / 100)        cy = H * (0.05 + 0.9 * (100 - y) / 100)
```

One helper used by the ball and the shots, so the two cannot disagree. The alternative (draw the lines at the
canvas edge, no margin) is a visual change to the established look and clips large shot circles; take it only on
an explicit instruction.

## Verification (Rule 90, CI-as-proxy; an artifact, not "looks right")

Extend `bsd_pitch_probe.js`: its expected positions change to the new mapping, and add booleans
`awayShotCentreInsideGoalLine` (the away goal's `cx >= W * 0.05`, the recorded `x = 2.7` of event 602347 min 43) and
`ballAtFivePercentIsInside` (a ball at pitch `x = 5` is drawn at `cx > W * 0.05`, not on it). Mutate first: revert the helper in a local build and
require both to go false. Smoke assertion on the helper. SW_VERSION bumped in both files.

## Done conditions

1. `outbox/bsd-pitch-probe-manifest-latest.json` on main has `pass: true` with the new booleans true.
2. `node smoke.js index.html` shows 0 failed; SW_VERSION equal in `index.html` and `sw.js`.
3. The committed screenshot shows the away goal inside the goal line (read the PNG).

**Result (2026-10-29, both runs):** `pass: true`, `failing: []`. Drawn rectangle `x 18, y 12, w 324, h 216` on a 360 x 240 canvas. The
away goal (pitch x = 2.7) is at `cx 26.748`, `r 9.76`: its centre is 8.7 px inside the goal line (`awayShotCentreInsideGoalLine`) and
the circle clears the canvas edge by 17 px (`awayShotNotClipped`; it was at `cx 9.72`, outside the line and cut, before). A ball
at pitch x = 5 is at `cx 34.2`, which is `18 + 324 * 0.05` (`ballAtFivePercentIsInside`; it sat on the line at `cx 18` before). The
ball at the served example (72, 47) is at `251.28, 126.48`, the formula's value to 0.01 px. Two booleans were added to the
CC-CMD's two after the first local mutation run showed a margin applied to ONE axis only slipped past the vendor-placement
check (a goal near the centre line has almost no y error): `homeShotAtTransform` and `awayShotAtTransform`, the served
sharedPitch formulas applied to the record to 0.01 px.
