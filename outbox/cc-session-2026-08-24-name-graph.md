# Six guards, one edge each, no graph

## Result

```
name graph — 7 edges over 8 nodes
  ok   slate-caps.keys        -> scale.keys
  ok   unreachable-dims.names -> scale.keys
  ok   dim-to-scale.values    -> scale.keys
  ok   dim-to-scale.keys      -> breakdown.dims
  ok   scale.keys             -> dim-to-scale.values
  ok   event.container-sports -> event.slug-sports
  ok   event.slug-sports      -> event.container-sports
```

Run against the **real pre-fix source**, committed as a fixture:

```
DIM_TO_SCALE values not in SCALE         ["matchup"]
DIM_TO_SCALE keys not in breakdown dims  ["matchupDepth"]
SCALE keys with no DIM_TO_SCALE entry    ["margin","finality"]
```

Three breaks, one run. In life they were found on three separate days by three
separate investigations.

## What prompted it

This session shipped six guards. Each was written after an incident, and each
covers exactly one edge:

| guard | edge |
|---|---|
| `check-scale-matches-implementation` | declared weight → implementation ceiling |
| `check-slate-caps-are-derived` | dim list name → SCALE key |
| `check-opts-keys-are-read` | call-site key → callee's opts read |
| `check-aggregate-launders-unknowns` | response field → aggregate |
| `DIM_TO_SCALE` completeness | breakdown key → SCALE key |
| candidate delta assertions | delta key → SCALE key |

The same shape sits under all of them: **something names something else, the
something else moves, and nothing connects the two.** Without a graph, one rename
surfaces as several separate incidents weeks apart — so the work is done six
times and the seventh case is still waiting.

## The case study

`SCALE.matchup` → `SCALE.margin`, era 6. One rename, weight-preserving, so the
era fingerprint could not see it, and **no diff on any line it broke**:

- `UNREACHABLE_DIMS` and `UNREACHABLE_DIMS_GAME` kept filtering on `'matchup'`.
  Both matched nothing. Reachable ceilings moved 245→277 and 270→294 silently,
  and `/quality` published `unreachable_points: 0` while still listing "matchup".
- `DIM_TO_SCALE` mapped `matchupDepth: 'matchup'`. `scoreUnder` coerced both
  misses to zero, rebuilt a **244-point rubric and reported `nominal_total: 294`**
  — and era 5's published headline was drawn from that block.
- Three candidate weightings carried `matchup`, no `margin`, no `finality`, and
  still summed to the pre-era-4 300.

## The edge that earns its place by direction

`scale.keys → dim-to-scale.values` looks redundant next to its forward twin. It
is not. `finality` sat in SCALE for a day with **no** `DIM_TO_SCALE` entry, and
every forward edge stayed green — because nothing named it, nothing could report
it. Only the reverse direction catches an addition rather than a rename.

## A null from a reader is a failure, never an empty set

`objectKeysAfter` returns `null` when its anchor moves, and `resolveEdges`
reports that as a reader failure rather than a pass. An empty set turns every
edge trivially green, which is how a check stops working without anyone
noticing — the failure mode of `briefs_counted: 0` one layer up.

Asserted three ways, plus that a map quoted in a comment contributes no names.

## What it does not do

Stated in the file so nobody trusts it further than it goes. It checks that names
**resolve**. It cannot check that a weight equals its implementation ceiling,
that an abstain scores the midpoint, that a regex means what its author intended,
or that a published total reconciles with its rows.

Those assertions stay where they are. The graph removes only the
name-resolution half — the half that kept recurring. **Adding a dependency is now
adding an edge, not writing a seventh script.**

## Files

- `scripts/lib/name-graph.mjs` — `NODES` (each reading from source or calling the
  real function), `EDGES` (each carrying the incident that justifies it),
  `resolveEdges`
- `scripts/check-name-graph.mjs` — the gate; `--self-test` replays every
  historical break
- `scripts/fixtures/dim-to-scale-at-5e0f066.js` — verbatim, with the `git show`
  command to reproduce it. A file rather than a git read because CI checkouts are
  shallow and a check that cannot run in CI is not a guard.
- `.github/workflows/deploy.yml` — the gate

## Next edges worth adding

Not built, and not blocking — each is one entry in `EDGES`:

- `CONTEXT_SOURCES` ids → the sport keys `assembleContext` filters on
- commentary type strings (`Shot Off Target`, `Shot Hit Woodwork`) → the types
  CONTRACTS.md records as observed
- `_EVENT_SLUG` values → the slugs `espnSummaryAllowed()` permits
