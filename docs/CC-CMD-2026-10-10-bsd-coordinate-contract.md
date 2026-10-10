# Claude Code Command — `/bsd/contract` misdescribes its own coordinate space

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (correction) — a published contract whose prose contradicts the data it describes

**Status:** SUPERSEDED 2026-10-10 by
`docs/CC-CMD-2026-10-10-bsd-coordinate-frames.md`, which was filed 5.5 minutes
later (2737d59 13:52:56 -> b1fad7c 13:58:25) and neither doc referenced the
other.

The two conflict on one point, and the later one is right. This doc's done
condition 2 requires `coordinateSystem.unresolved.y` naming the shotmap as the
resolver; `-frames.md` RESOLVES y, from the shotmap — `gml` agrees with
`sign(gm.y - 50)` on 24 of 24 shots in 223324, identically on both sides, which
makes the two frames a rotation rather than a reflection. So `unresolved.y` was
deliberately NOT added: adding it would have published an open question that had
already been answered by the evidence this doc asked for.

Everything else here is carried, not dropped: per-team axes, the real
`avgPosition` example, the required-on-away transform with the `scaleX(-1)`
warning, the keeper-spread check, and the `websocket_plus` finding in the
`avgPosM` comment. Executed under the later doc on 2026-10-10 — see
`outbox/cc-session-2026-10-10-bsd-coordinate-frames.md`.

## CONTEXT — the single source of truth is wrong about x

`/bsd/contract` (`src/index.js:10174`, object at `:10177`) declares itself "single source of truth for
the BSD coordinate system. Public, no token required, no upstream fetch. Both
relay and client read this to keep coord transforms in sync." It has carried
`status: 'provisional — pending live BSD verification of axis convention'` at
`revision: '2026-06-25-1'` for 107 days.

The axis convention is now verified, and the contract is wrong.

### The measurement

A goalkeeper's average position is the one unambiguous landmark on a pitch: he
stands in front of the goal he defends. Eight keepers, four matches, probed
2026-10-10 via `/bsd/events/{id}/average-positions`:

| event | competition | side | keeper | x | y |
|---|---|---|---|---|---|
| 213708 | Bundesliga (today) | away | M. Neuer | **11.5** | 50.9 |
| 213708 | Bundesliga (today) | home | F. Dahmen | **9.4** | 49.5 |
| 210110 | Serie A (today) | away | D. De Gea | **10.9** | 53.0 |
| 210110 | Serie A (today) | home | J. Bijlow | **9.8** | 47.4 |
| 223324 | — | away | Everson | **10.4** | 50.4 |
| 223324 | — | home | Cleiton | **10.6** | 49.0 |
| 207987 | — | away | F. Torgnascioli | **9.4** | 52.7 |
| 207987 | — | home | F. Zenobio | **12.8** | 49.8 |

Range 9.4–12.8. **Not one keeper above 13.**

The contract declares `x: 'horizontal, 0 = home goal-line, 100 = away goal-line'`
and `origin: 'home-team-defending-goal-line, bottom-left corner'`. Under that
model every away keeper belongs at x ≈ 87–91. Four of four are at x ≈ 10.

### What the data actually is

**x is per-team, measured from each side's OWN goal line.** Every team's
coordinates are in its own attacking frame: 0 is the goal you defend, 100 is the
goal you attack. The outfield gradient confirms it independently — both sides of
213708 run low-x defence to high-x attack:

```
Bayern   (away)  Neuer 11.5 | Tah 42.8  Upamecano 47.0 | Kane 69.5  Gnabry 74.6  Karl 84.2
Augsburg (home)  Dahmen 9.4 | Gouweleeuw 12.0  Matsima 22.3  Bah 26.2 | Gregoritsch 48.9  Ribeiro 65.9
```

Under a shared pitch axis one of those two gradients would have to run the other
way. Neither does.

### The transform below it is already correct

`transformReference.mirrorForAwayPerspective: 'x = 100 - x; y = 100 - y'`
(`:10211`) is exactly right, and for a reason the prose above it denies: rotating
a pitch 180° maps (x, y) to (100−x, 100−y), which is precisely what reconciling
two own-goal-relative frames requires. What is wrong is its framing as an
optional "away perspective" view. It is **mandatory, on the away side only**, to
draw both teams on one pitch at all. Do not delete it; promote it.

## TASKS

### Task 1 — restate `coordinateSystem` as per-team

In the `/bsd/contract` response object:

- `space` — `'normalized-pitch-per-team'`
- `origin` — `'each team\'s OWN defending goal-line, bottom-left as that team attacks'`
- `axes.x` — `'horizontal, PER TEAM: 0 = the goal this team defends, 100 = the goal this team attacks. NOT a shared pitch axis.'`
- `axes.y` — leave the wording as it is and add the `unresolved` field from Task 4.
- Add `verifiedBy`: the eight-keeper measurement above, named by event id, so the
  next reader does not have to re-derive it.
- `revision` → `'2026-10-10-1'`
- `status` → `'verified (x): per-team frames, measured on 8 keepers across 4 events. y UNRESOLVED — see coordinateSystem.unresolved.'`

Write the reason in the comment block, not only in the field. The prose above the
transform is what misled; a corrected field with no recorded reason invites the
same drift back.

### Task 2 — promote the mirror from optional to required

`transformReference` gains a required-on-away entry, and
`mirrorForAwayPerspective` keeps its formula with its purpose corrected:

```
awaySideToSharedPitch: 'REQUIRED for the away side before drawing both teams
  on one pitch: x = 100 - x  (y: see coordinateSystem.unresolved). Each side is
  in its own attacking frame, so rendering both unmirrored stacks the away team
  on top of the home half.'
```

**It is a data transform, not a CSS one.** A container `transform: scaleX(-1)`
mirrors the home side too, plus every name, number and label inside it. Say so in
the comment, because that is the fix a reader reaches for first.

### Task 3 — correct the record shape

`frameShapes.avgPosition.example` currently reads
`{ player: 'N. Kanté', x: 38.5, y: 52.0, touches: 71 }`. The real record,
measured on all four events:

```json
{ "n": 149, "x": 57.6, "y": 40.5, "pos": "M", "name": "J. Kimmich", "player_id": 2461 }
```

`player` → `name`, `touches` → `n`, and `pos` and `player_id` are undocumented.
`pos` takes `G | D | M | F` across all four payloads.

**`n` is not a shirt number** — it repeats within one team, which a shirt number
cannot: 207987 home carries two `n: 32` (V. Moreno, G. Soto); 223324 away two
`n: 55` and two `n: 64`; 213708 home two `n: 9` and two `n: 58`. It behaves like a
count, which matches what the contract called `touches`. **That is inference from
the duplicates, not proof** — document it as `n` with the duplication evidence and
do not relabel it `touches` until BSD's docs or a controlled probe confirms it.

### Task 4 — name y as unresolved rather than implying it

All eight keepers sit at y ≈ 47–53. A keeper stands in the middle of his own goal
under every mirroring convention, so this sample **cannot** distinguish a y-flip
from none. Add to `coordinateSystem`:

```
unresolved: {
  y: 'Whether the away frame also mirrors y is NOT settled. All 8 keepers
      measured sit at y 47-53, which is symmetric under both conventions and
      therefore discriminates nothing. Resolve with /bsd/events/{id}/shotmap
      on an event with a known goal: a goal is at one specific end and one
      specific side, so its (x, y) anchors both axes at once. Until then a
      renderer must not silently assume either.'
}
```

Rule 99: a renderer that picks a y convention and shows no sign of having guessed
is the collapse this names. An unresolved axis stays named as unresolved.

### Task 5 — the discriminating check, written down

The check a reader would reach for — "verify the home keeper's average x" — reads
9.4 and 12.8 here, concludes "x is low, so the feed is not inverted," and passes
while the away team is drawn on top of the home half. It is blind to the only
defect present.

The test that discriminates is **both keepers at the same end**:

```
|home_gk.x - away_gk.x| < 20   =>  per-team frames; mirror the away side
|home_gk.x - away_gk.x| > 60   =>  a shared pitch axis
anything between               =>  NOT OBSERVABLE; do not render a pitch
```

Measured spreads: 213708 → 2.1, 210110 → 1.1, 223324 → 0.2, 207987 → 3.4. All
four land in the first branch by a wide margin.

Add this as a comment on the contract and, if a pitch view is ever built, as its
precondition. Three states, not two — the middle band is a real answer.

### Task 6 — the availability finding, and a correction to this route's own record

Average positions **do not exist during play**. Both in-progress matches probed
2026-10-10 returned `{}`, which is the behaviour the route already documents after
the 2026-08-13 six-event measurement. The route is correct and needs no change
here.

What does need changing is one claim in that comment block (`:10399` and above).
It records `average_positions` as "populated {away, home} for the 4 FINISHED
events". Probed today:

| event | `websocket_plus` | state | result |
|---|---|---|---|
| 213708 | **true** | finished today | populated, 2,223 B |
| 210110 | **true** | finished today | populated, 2,362 B |
| 588245 | **false** | finished today | `{}` |
| 588246 | **false** | finished today | `{}` |
| 587659 | unread | finished (historical) | `{}` |

Four matches that finished on the same day split exactly on the tier flag, and
`587659` — named in the existing comment as one of the populated finished events —
now returns `{}`.

So match state is **not sufficient**: a finished event on a competition without
the tracking tier has no average positions and never will. Amend the comment to
say so, and have the route surface the distinction rather than leaving three
causes behind one empty object. `{}` currently means "still in play", "tier not
subscribed for this competition" and "finished but nothing was captured" at once.
The live-event feed already carries `websocket_plus` per event, so the route can
tell the first two apart cheaply.

**Do not change the empty-object return for a match in play** — that is the
deliberate "not yet" the 2026-08-13 session built, and it is correct.

## DONE CONDITIONS

1. `/bsd/contract` returns `revision: '2026-10-10-1'`, `space:
   'normalized-pitch-per-team'`, and an `axes.x` that says per-team. Verify by
   fetching the live route, not by reading the source.
2. `coordinateSystem.unresolved.y` is present and names the shotmap as the
   resolver.
3. `frameShapes.avgPosition.example` matches a record this CC-CMD quotes, field
   for field.
4. The required-on-away transform is present and its comment states that a CSS
   `scaleX(-1)` is the wrong mechanism.
5. The keeper-spread check and its three states appear as a comment on the
   contract.
6. The `websocket_plus` finding is in the `avgPosM` comment block, with the
   `587659` correction stated rather than quietly dropped.
7. `outbox/` entry naming the eight keepers, the four events, the four spreads,
   and what stayed unresolved.

## STOP CONDITIONS

- **Do not resolve y.** Nothing measured today distinguishes the two conventions.
  If the shotmap is probed and settles it, that is a second CC-CMD with its own
  measurement, not a line added here.
- **Do not build a pitch renderer.** This is a contract correction. A renderer is
  a separate ask with its own ADR-002 pass.
- **Do not touch `jubilant-bassoon`.** `average_positions` appears there only in
  `docs/` — two CC-CMDs and `docs/adapter-fixtures-bsd-ok.json` /
  `adapter-fixtures-bsd-empty.json` — and in no client source, so there is no
  transform to fix. Those two fixtures may encode the old shared-axis assumption;
  **that is unread and unverified**, so report it rather than editing it.
- If `/bsd/contract` turns out to be consumed by something this document has not
  found, stop and report before changing the field names.

## PROVENANCE

Every figure above was read from the live relay on 2026-10-10 between 14:19Z and
17:55Z via `probe_relay_route`. Events 213708 and 210110 kicked off 13:30Z and
13:00Z the same day; 223324 and 207987 are historical and were named in the
existing `avgPosM` comment. Nothing here is transcribed from documentation.
