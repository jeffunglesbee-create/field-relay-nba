# Claude Code Command — 11 routes are outside the provenance population, not merely undeclared

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (gap) — the gate measures the right thing over the wrong population
**Status:** FILED, not started.

**Second CC-CMD per Rule 87.4**, opened rather than widening
`docs/CC-CMD-2026-10-11-nhl-shift-charts-on-ice.md`, which closed DONE today.
That document shipped `/nhl-stats/*`; this one is about the gate that could not
see it.

## The measurement

`scripts/lib/route-scan.mjs` builds its route population from one regex:

```js
const RE = /pathname\s*(===|\.startsWith\()\s*'([^']+)'/g
```

Two spellings. A third exists and is in use — `pathname.match(/^\/.../)` —
and those routes are not counted at all. Measured on `src/index.js`,
2026-10-11:

```
9  /bsd/...     (regex-matched sub-paths)
1  /cfl...
1  /nhl-stats...
──
11 routes outside the population
```

`check-route-provenance.mjs` then prints **"189 routes mapped, 187 with a
declared source"** and holds an undeclared budget of 1. Both numbers read as
claims about the router. Neither denominator contains these 11.

This is Rule 91 at the level of the gate rather than the probe: the coverage is
invisible where the result is read, so a green result is taken for a statement
about everything.

## What is NOT broken

Gate 2 — *every data surface is in the manifest* — keys on
`outbox/provenance-census-latest.json`, the **runtime** census's own path list,
not on this scan. Any regex-routed path the census has actually probed is
therefore still covered. The hole is in the static population, and it is
bounded by what the census has reached.

## How this was found

`/nhl-stats/*` shipped inside `if (pathname.startsWith('/bsd/'))`, where no
such request can arrive. The generated manifest recorded the consequence
without anyone noticing: `"/bsd/"` listed `api.nhle.com` among its sources,
because the block was lexically inside it. When the route was moved to the top
level the host disappeared from `/bsd/` — and no `/nhl-stats` entry appeared,
because the scanner cannot see it.

So the manifest held a **false** source for `/bsd/` for as long as the
misplacement lasted, and holds **no** entry for the moved route now. The first
is the worse failure and the generator produced it silently.

## Tasks

**Task 1 — probe the third spelling before extending the regex.** Report, from
HEAD, every `pathname.match(...)` route with its line and the literal prefix
its pattern anchors on. The count above is from a grep over
`pathname\.match\(/\^\\/[a-z0-9-]+`; a pattern built from a variable or
spanning lines would not appear in it, and that is the number this task must
produce honestly. If any route's prefix is not a static literal, STOP on that
one and report it — a prefix the scanner must evaluate is not a parsing gap, it
is a different problem.

**Task 2 — extend the population, and make the denominator say so.** Add the
`pathname.match` spelling. The printed summary must then carry the breakdown by
spelling — `189 routes: 178 exact/prefix, 11 regex` — so a future reader can
see which populations a pass covers. Rule 91: in the printed result, not a
comment.

**Task 3 — the mutation, written before the change.** Delete one regex route
from `src/index.js` and confirm the extended scan's count drops by one; add a
regex route with no declared source and confirm the gate goes red for it. A
scan that cannot be made to miss a route it should find is not a scan. Report
ANCHOR rather than a false CAUGHT if the anchor stops matching (Rule 90's
corollary).

**Task 4 — the false source is the finding, not the missing entry.** Assert
that a route block's declared sources come from its own body and not from an
enclosing block's. The `/bsd/` entry naming `api.nhle.com` is the case study
and it must be reproducible as a red gate: nest a route claiming a foreign host
inside another prefix's block and require the gate to object.

## Stop conditions

- Do not change any route's placement or behaviour in this document. The scan
  and its gate are the subject.
- Do not raise the undeclared budget to make a count fit. If the extended
  population has more undeclared routes, that is the measurement.
- If extending the regex makes the brace-balancer report `truncated: true` on
  blocks it previously read whole, STOP — the degrade-to-partial path is the
  one documented safety property and losing it costs more than the coverage
  gains.

## Done conditions

1. Every `pathname.match` route at HEAD is listed with its line and literal
   prefix, with the count stated and the grep that produced it named.
2. The scan's population includes the third spelling, and the printed summary
   breaks the total down by spelling.
3. A mutation proves the extended scan can miss a route and can object to an
   undeclared one.
4. A nested route claiming a foreign host makes the gate red.
5. `src/index.js` is byte-identical except where Task 3's mutation restores it.
