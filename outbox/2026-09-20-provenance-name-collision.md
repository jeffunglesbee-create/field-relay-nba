# The provenance generator's name collision — and my wrong explanation of it

## What I published, and what it actually was

On 2026-09-19 I wrote, in a commit message and an outbox entry:

> route-provenance.js attributed api.prod.whoop.com as an upstream to four
> SPORTS routes ... **It attributes hosts across route boundaries, same family
> as CC-CMD-2026-09-13.**

The observation was right and reproducible. **The mechanism was wrong**, and I
published it without tracing it — Rule 100's corollary exactly: an untested
premise reported as a finding.

The real mechanism, found by instrumenting the generator:

    TRACE /odds: whoop comes from NOWHERE VISIBLE
    BARE-CONST: name=base -> api.prod.whoop.com

`BASES` is a flat `name → URL` map built from every `const NAME = 'https://…'`
in `src/`. It has **no notion of scope**. Inside the Whoop block sat:

```js
const base = 'https://api.prod.whoop.com/developer/v1';
```

`base` is declared **fourteen times** across `src/` — thirteen of them ordinary
locals holding something else. Both of the generator's lookups (`${name}` and
the bare-name scan) consulted the flat map, so every route with its own `base`
resolved to Whoop's host. Nothing to do with boundaries or brace counting.

## The fix: a local declaration shadows the global constant

If the text being scanned declares the name itself, that declaration is what the
code at that site means.

**It also corrected a live entry nobody was looking for.** `/mcp` claimed
`stat-job-watcher.jeffunglesbee.workers.dev` because a different route declares
`const statBase = 'https://stat-job-watcher…'`, while `/mcp`'s own `statBase` is
`` `${url.origin}/stat` `` — the relay itself, which `SELF_HOSTS` correctly
excludes. One false attribution removed from the shipped manifest.

### A blunter fix, measured and rejected

Culling every name ever declared without a URL kills `base` but also kills
`statBase` and `ESPN_SUMMARY_BASE` (2 declarations, 1 with a URL each). Cost,
measured rather than guessed: `/espn-summary` fell to `undeclared`, `/mcp` lost
its real host, `/nfl/epa/plays` lost ESPN. Shadowing costs none of them.

## ~~A SECOND mechanism exists and is NOT fixed~~ — FIXED 2026-09-20 (`484557d`)

The fixture route `/gamma` declares no `base`, calls one helper, and fetches only
`VENDOR_API` — and still collected `fitness.example.com` from a function it does
not call.

**The heading above was wrong about what it was.** Calling it "a second
mechanism" alongside a name-collision fix put it in the reader's head as another
scoping problem. It is not about scoping at all.

`bodyOf()` in `scripts/lib/route-scan.mjs` ended a delegated handler at the
**next top-level `function` declaration**. Everything between the two came with
it, and when the handler is the *last* function in a file nothing matches, so
the body runs to end of file. `handleGamma` is last in the fixture, so `/gamma`
swallowed the whole dispatch block — `handleBeta` included.

`functionBody()`, thirty lines away in the same file, already carried the
correction, with a comment explaining it: *"Brace-balance, not 'until the next
function declaration'"*, written after the old rule cost `/odds` two ESPN hosts.
**The fix had been applied to one of the two places that needed it.** That is the
finding worth keeping — not the leak, but that a correction landed in one caller
and the sibling kept the bug with the explanation sitting next to it.

**Live impact: none, measured.** 0 of 187 manifest route entries change; 0 lines
of census output change; `check-route-provenance` passes at 187 mapped / 185
with a declared source.

Now gated: `mutate-provenance-shadowing.mjs` mutates **two** files, and `S2`
restores the old boundary and watches `/gamma` go red. The `/gamma` invariant is
an exact match rather than `includes`, for the reason in the next section.

## The assertion that hid it

My first version of the `/gamma` invariant was:

```js
one('/gamma resolves an unshadowed module constant', base.gamma, 'vendor.example.com', …)
```

using `includes`. It passed — while `base.gamma` was
`fitness.example.com + vendor.example.com`. **An assertion that checks a value is
present says nothing about what else is.**

Fourth instance of that class in two days: R5's `default` branch, S6's
coinciding fixture, B4/B5's untested branches, and now this. The common shape is
a test that confirms the thing it hopes for and never asks what else is true.

**A fifth, added 2026-09-20 while fixing the above, and it is the expensive
kind.** Mid-investigation I measured `handleV2Games` as 394 lines by brace
balance against `bodyOf`'s 718, and read it as live over-capture on `/v2/` and
`/v2/games`. It is false. The 394 came from a throwaway `//`-stripper of my own,
which breaks on any line where `//` sits inside a string or a regex — line 4898
is the real closing brace and 4589 is mid-function, so 703 is correct. One
`sed -n` at each candidate line settled it.

The difference from the other four: that one was about to be *published* as a
finding, not merely believed. Rule 100's corollary is the whole lesson —
believing an untested premise briefly costs nothing; filing it hands a reader
something to un-learn.

## Verification

| what | result |
|---|---|
| `mutate-provenance-shadowing.mjs` | 3/3 gated invariants, 1/1 mutation caught, 1 known gap reported |
| S1 (disable shadowing) | CAUGHT — the fixture route reclaims the foreign host |
| live manifest delta | one line: `/mcp` loses a host it never called |
| `check-route-provenance.mjs` | PASS — 187 routes, 185 with a declared source |
| all `deploy.yml` node gates | 67/67 |

The harness runs the **real generator** against a fixture rather than matching
source text, because a source check passes on a `shadowed()` that can never fire.
