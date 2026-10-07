# CC session 2026-10-06 — the tennis split stops being a copy

**Repo:** field-relay-nba (reads jubilant-bassoon; no change there)
**HEAD progression:** `74b242e` → `963bbab` → `4f7f8f4` (run 10's artifact) →
`7df7363` → `0fd9d43` (run 11's artifact)
**Checks:** `scripts/check-client-tennis-split.mjs` 37 of 37
**Confidence:** 96
**Credits spent at the Odds API vendor:** 0

Follows `outbox/cc-session-2026-10-06-bjk-cup-draw-unreachable.md`, which closed
the finding and left this as the open item: *"the probe's client lists are still
literals copied from another repo."*

---

## The defect being removed

`scripts/tennis-tier-ladders.mjs` held two string literals naming which team
events jubilant-bassoon's Draw tab admits and which it excludes. A copy has one
failure mode and it had already happened: the client changed on 2026-09-21,
nothing mirrored it here, and the run was red against its own stale copy for
three weekly scheduled runs. The reverse is worse and silent — a list edited
only here reports drift that does not exist.

The script's own header said the client *"cannot notice — its lists are
literals"* while its lists were literals too.

## What it reads now

Two texts, because they answer different questions:

| | what it is | what it decides |
|---|---|---|
| **DEPLOYED** | `jubilant-bassoon.jeffunglesbee.workers.dev/` | the drift verdict — the question is whether a real draw is unreachable, and this is the page a reader loads |
| **SOURCE** | `src/legacy/field.js` on main, via raw.githubusercontent | disagreement with DEPLOYED is a client change that has not shipped, reported as its own finding |

`index.html` is deliberately **not** read: its script block is generated from
`field.js` by `scripts/sync-source.mjs`, so it is a copy of the source inside
the source's own repo.

Unauthenticated, no new secret. jubilant-bassoon is public — verified
2026-10-07 by `gh api repos/jeffunglesbee-create/jubilant-bassoon` reading
`"visibility": "public"`. If it is ever made private the read fails loudly: an
error page contains neither anchor, so the parse throws (covered by assertion
R3).

## Refusal is not agreement

Every failure throws, the run records it in
`summary.clientSplitRefusals`, and it exits 1. An unreadable client must never
yield an empty exclusion list, because an empty list makes the drift comparison
vacuously true and the run **green** — a green meaning "I could not look" is the
one outcome worse than red. There is no fall back from one text to the other.

Proven rather than asserted: letting a failed read return empty lists instead of
refusing turns 4 assertions red.

## Done condition — met on run 11

```
run 11  2026-10-07T03:22:31Z  success
deployed  ex ["Davis Cup","Billie Jean King Cup Group I"]
          ad ["ATP Finals","WTA Finals","Next Gen Finals","United Cup","Billie Jean King Cup"]
source    (identical)
agree true   refusals []   drift []   contradictions []
```

Coverage: `perTier: 1`, so 14 editions of the 42 a full run reads. The split
check lives in the named-event loop, which reads all 7 named events regardless
of `perTier`.

## Run 10 refused, and that was the mechanism working

```
run 10  2026-10-07T03:18:37Z  failure
DEPLOYED https://jubilant-bassoon.jeffunglesbee.workers.dev/: the rank map parsed to zero names
source: read and parsed correctly
sourceAgreesWithDeployed: null
```

The map was present. **esbuild normalizes string literals to double quotes** —
and rewrites `const` to `var`, which the anchors do not depend on — and the key
matcher required single quotes.

This was a premise tested on the wrong artifact. I confirmed the anchors survive
`scripts/strip-comments.js` and inferred the rest; the pipeline is
`build-bundle.mjs` **then** `strip-comments.js`, and esbuild is the half that
reformats. Reproduced locally by running both, which prints:

```
var _TENNIS_DRAW_NAMED_RANK = {
  "ATP Finals": 1,
  ...
var _TENNIS_DRAW_NO_BRACKET = /^(Davis Cup|Billie Jean King Cup Group I)$/;
```

The regex literal survives verbatim, so only the key matcher needed widening.
The check's DEPLOYED fixture is those bytes, not a second reading of the source
shape.

**The refusal now carries an excerpt of what was at the anchor.** Without it the
message said only "parsed to zero names", and finding out why took reproducing
the client's build. A refusal that does not show what it was looking at costs
the next reader that hour again.

## Three defects the mutations found, not the reading

| mutation | what it exposed |
|---|---|
| M8 — the client's own pre-2026-10-07 regex shape | the first capture was `[^)]*`, which could not match `Cup( Group I)?)$/` at all, so it threw "constant not found" about a constant that was present. Refusing was safe; the diagnostic was wrong |
| C — narrow the key matcher back to single quotes | a positive control that threw crashed the suite with a stack trace where its result line belonged. It now reports as a named FAIL and 5 assertions go red |
| C, again | the pass/fail denominator moved between a clean run (34) and a mutated one (35), because the parse helper counted failures but not passes. The total is now derived — a hardcoded one is how `self-test: 28/28` kept printing 28 after three assertions were added, in this repo, last month |

## A constraint this creates, written down because it is not obvious

The client must spell each arm of `_TENNIS_DRAW_NO_BRACKET` as a **literal
name**. An arm carrying regex syntax is one arm standing for several names and
this parser refuses rather than guessing which. If someone reintroduces
`Billie Jean King Cup( Group I)?` the run goes red with a message naming the
fix and pointing at the client.

## Open, not done

- **`tennis-tier-ladders.yml` is still undeclared** in
  `docs/declared-detectors.json`. It is green, so there is nothing to declare —
  but the next real finding will read as a dead cron again for three weeks
  before anyone looks. The gap is the dead-cron watch's grace window, not this
  workflow.
- **`chrome-inventory.yml` (jubilant-bassoon) has failed on every run since
  2026-09-13**, undeclared, while the same check passes as step 22 inside
  `deploy-gate.yml`. Untouched and uninvestigated.
