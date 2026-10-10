# Claude Code Command — /bsd/contract declares one coordinate frame; BSD serves four

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (correctness) — a declared single source of truth that is wrong
**Status:** DONE 2026-10-10. All seven tasks executed; three stop conditions
checked and none hit. Session doc:
`outbox/cc-session-2026-10-10-bsd-coordinate-frames.md`.

**Rule 47:** untouched. Nothing here adds relay-side processing; every task
corrects a declaration or adds a verifier over a committed capture.

## Why this exists

`/bsd/contract` (`src/index.js:10177`) has carried
`status: 'provisional — pending live BSD verification of axis convention'` at
`revision: '2026-06-25-1'` for three and a half months, and the route's own
comment says why it could not be settled: average positions never arrive during
play. On 2026-10-10 the question was settled anyway — the data needed is in
FINISHED events, which were always available.

**The declared axis is false, and the transform printed four lines below it is
correct.** Both statements are measured below.

## MEASUREMENT 1 — x is per-team, from each team's OWN goal line

`coordinateSystem.axes.x` declares `'horizontal, 0 = home goal-line, 100 = away
goal-line'`. Under that, an away goalkeeper belongs at x ≈ 90. Six goalkeepers,
three events, probed via `/bsd/events/{id}/average-positions` 2026-10-10:

| event | side | keeper | x | y |
|---|---|---|---|---|
| 223324 | away | Everson | **10.4** | 50.4 |
| 223324 | home | Cleiton | **10.6** | 49.0 |
| 207987 | away | F. Torgnascioli | **9.4** | 52.7 |
| 207987 | home | F. Zenobio | **12.8** | 49.8 |
| 213708 | away | M. Neuer | **11.5** | 50.9 |
| 213708 | home | F. Dahmen | **9.4** | 49.5 |

Every keeper sits at x between 9.4 and 12.8. Not one is near 90.

The outfield gradient agrees. 213708 home (Augsburg): keeper 9.4, Gouweleeuw
12.0, Matsima 22.3, Bah 26.2, Massengo 40.2, Gregoritsch 48.9, Ribeiro 65.9.
213708 away (Bayern), independently: Neuer 11.5, Tah 42.8, Upamecano 47.0,
Kimmich 57.6, Kane 69.5, Karl 84.2. Both sides run low-defence to high-attack
**from their own keeper**, which a shared axis cannot produce for both.

**So x is 0 at the goal a team DEFENDS and 100 at the goal it ATTACKS, per
team.** `origin: 'home-team-defending-goal-line, bottom-left corner'` describes
a shared pitch the data does not use.

## MEASUREMENT 2 — y flips with x, because the frames are a rotation

Two frames related by swapping which goal is the origin are either a 180°
ROTATION of the pitch, which maps `(x, y) -> (100-x, 100-y)`, or a REFLECTION,
which maps `(x, y) -> (100-x, y)` and reverses handedness. Only the second
leaves y alone, and it is ruled out by the goal-mouth labels.

Every shot in `/bsd/events/223324/shotmap` carries both `gm.y` and `gml`, a
human label. Across all 24 shots, **for both teams**:

```
gm.y > 50  <->  gml contains "left"   (71.1, 67.7, 62.4, 57.8, 57.0, 52.7, 52.3)
gm.y < 50  <->  gml contains "right"  (48.0, 47.3, 47.3, 45.9, 42.4, 38.7, 37.1, 36.1, 35.8)
gm.y ~ 50  <->  gml contains "centre"
```

24 of 24, with no exception, and the relation holds identically on `home: true`
and `home: false` shots. "Left" means the same relative side for both teams, so
each team's lateral axis is expressed in its own attacking direction with the
SAME handedness — a rotation, not a reflection.

**Therefore `mirrorForAwayPerspective: x = 100 - x; y = 100 - y` is exactly
right.** What is wrong is its framing as an optional "away perspective" view. It
is mandatory, applied to the away side only, to draw both teams on one pitch at
all. Whoever wrote the transform modelled the data correctly; the prose above it
does not.

Residual assumption, stated: this argues from one event's label agreement. It is
cheap to widen — Task 6 makes it a check that runs on every capture.

## MEASUREMENT 3 — there are FOUR frames, not one

The contract documents one coordinate system and four payload shapes under it.
The shapes do not share a frame.

| frame | where | x = 0 means | notes |
|---|---|---|---|
| **own-goal-relative** | `average_positions[]` | the goal this team DEFENDS | per team |
| **target-goal-relative** | `shotmap[].pos`, `incidents[].sequence[].pos`/`.end` | the goal this team ATTACKS | per team; **opposite origin to the frame above** |
| **goal plane** | `shotmap[].gm` | always 0 — not a pitch axis | `{x: 0, y: across mouth, z: height}`; `gml` labels it |
| **goal mouth 2-D** | `incidents[] goal .gm` | horizontal % across mouth | `{x, y}` with y measured DOWNWARD |

The two pitch frames having opposite origins is the trap. `shotmap[].pos.x` for
all 24 shots in 223324 falls between **2.3 and 30.8**, for both teams — shot
distance from the goal attacked. The same event's keeper averages are 10.4 and
10.6 under the other convention. **A reader who applies one frame's rule to the
other draws shots into the shooter's own penalty area.**

Independent confirmation that `pos` is target-relative: the 73' goal incident in
223324 carries `gk: {x: 5.4, y: 48.4}` beside `pos: {x: 7.3, y: 48}` for away
scorer T. Cuello. The DEFENDING keeper reads x = 5.4 in the shooter's frame —
in front of the goal being attacked, not his own half.

The two `gm` shapes are the same goal, described twice. Shotmap:
`{x: 0, y: 49.3, z: 2.5}` with `gml: "low-centre"`. Incident:
`{x: 55.38, y: 94.67}` — centre horizontally, 94.67 of the way DOWN. Same shot,
inverted vertical axis, same key name.

## MEASUREMENT 4 — availability is tier-gated, not just post-final

The route comment at `src/index.js:10363` records a 2026-08-13 measurement:
`/stats/`'s embedded `average_positions` was "populated {away, home} for the 4
FINISHED events and {} for the live one". The post-final half holds. The
"4 of 4" no longer does.

Probed 2026-10-10, six events:

| event | state | `websocket_plus` | result |
|---|---|---|---|
| 213708 Augsburg–Bayern | finished today | **true** | populated |
| 223324 | finished | unknown | populated |
| 207987 | finished | unknown | populated |
| 588245 Altrincham–Aldershot | finished today | **false** | `{}` |
| 211914 Cracovia–Zagłębie | in progress | true | `{}` |
| 210110 Genoa–Fiorentina | in progress | true | `{}` |

Both in-progress events return `{}` — the honest "not yet" the route was
written to serve, confirmed. But a FINISHED event with
`websocket_plus: false` also returns `{}`. So the discriminator is match state
AND the tracking tier, and the comment currently names only the first.

`websocket_plus: false` + finished is therefore a THIRD state — "this
competition never carries it" — distinct from `{}` "not yet" and 404 "no such
data". It is not distinguishable in the response today.

## Tasks

**Task 1 — correct `coordinateSystem`.** `origin` and `axes.x` restated as
per-team, own-goal-relative. Quote the six-keeper table as the measurement, with
its date. Do not delete the old wording silently; record that it was wrong and
what disproved it.

**Task 2 — document all four frames.** The table in MEASUREMENT 3, as a
`frames` object keyed by payload path, so a reader looks up
`shotmap[].pos` rather than inferring from a single `coordinateSystem`.

**Task 3 — promote the mirror.** `mirrorForAwayPerspective` becomes
`mirrorAway`, documented as REQUIRED on the away side for any single-pitch
render, both axes, with "rotation, not reflection" and the `gml` evidence as its
reason. Keep the formula byte-identical — it is correct.

**Task 4 — fix the record shapes.** Measured, not assumed:

```
average_positions[]  { n, x, y, pos, name, player_id }
shotmap[]            { gm{x,y,z}, pos{x,y,z}, block{x,y,z}?, xg, xgot,
                       gml, min, sit, body, home, type, gtype?, added?,
                       player_id, xg_estimated }
incidents[] sequence { event, pid, player, pos{x,y}, end{x,y}?,
                       gk{x,y}?, gm{x,y}?, body?, assist? }
```

The current `avgPosition` example reads `{player, x, y, touches}`. The real keys
are `name` and `n`; `pos` and `player_id` are undocumented. **`n` is not a shirt
number** — 207987's home side carries two players at `n: 32`, and 223324's away
side two at `n: 55` and two at `n: 64`, which is impossible on one team. It
behaves like a touch count. Document it as a count whose exact definition is
unconfirmed rather than renaming it `touches` on the strength of the old
example.

The current `shot` example reads `{x: 88.3, y: 51.5, ...}`. No field in the real
shot record holds 88.3 as a bare `x`: `gm.x` is always 0 and `pos.x` spans
2.3–30.8. Replace it with a verbatim capture.

**Task 5 — correct the availability comment** at `src/index.js:10363` with the
six-event table, and add the tier to the response so a caller can tell "never
for this competition" from "not yet". An empty object with
`X-Source: stats-embedded` cannot carry that today; a header or a wrapper field
is the relay's call, but the three states must be distinguishable at the
boundary. Rule 99: absence must be a sibling of the value.

**Task 6 — the verifier, over a committed capture.** Two assertions, no live
match required:

1. **`gml` agrees with `sign(gm.y - 50)`** on every shot — this is the
   self-describing control that settled y, and it is the one field in the feed
   that labels its own number. It must hold for `home: true` and
   `home: false` alike; a split by side would mean reflection, and the mirror
   in Task 3 would be wrong.
2. **`|home_gk.x - away_gk.x| < 20`** over `average_positions` where both sides
   carry a `pos: "G"` — the test that discriminates per-team frames from a
   shared axis. Note what it replaces: checking the HOME keeper's x alone reads
   10.6 and concludes correctly that x=0 is the home goal, while the away side
   is silently drawn into the home half. The one-sided check passes on broken
   data.

Commit a capture of 223324 (`average-positions`, `shotmap`, `incidents`) as the
fixture. It carries both goalkeepers, 24 labelled shots across both teams, and a
goal sequence with `gk`.

**Task 7 — `revision` to `2026-10-10-1`, and drop `provisional`.** The axis
convention is measured. Replace the status with what remains open, which is
Task 5's third state and nothing about the axes.

## Stop conditions

- If Task 6's assertion 1 splits by side on any capture, STOP. That means
  reflection, not rotation, and Task 3 is wrong — report before changing the
  transform.
- If any task would add computation to the relay, STOP. Rule 47; this is a
  declaration repair.
- Do not change the `/bsd/contract` formula. It is the one part that was right.

## Done conditions

1. `/bsd/contract` returns `revision: 2026-10-10-1`, no `provisional`, per-team
   axes, four documented frames, and verbatim record shapes.
2. The route comment at `src/index.js:10363` carries the six-event table.
3. The three availability states are distinguishable in the response.
4. The verifier runs green on a committed 223324 fixture, and its mutation —
   a one-sided keeper check, or `gml` agreement asserted on home shots only —
   fails.

## Provenance

Every number above was read live on 2026-10-10 from
`/bsd/events/live`, `/bsd/events/{id}/average-positions`,
`/bsd/events/{id}/shotmap` and `/bsd/events/{id}/incidents`, through the
relay. 83 events were live at 14:17Z; 213708 (Augsburg–Bayern, Bundesliga) is
the finished-today sample.
