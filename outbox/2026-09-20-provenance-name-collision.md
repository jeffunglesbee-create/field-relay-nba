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

## A SECOND mechanism exists and is NOT fixed

The fixture route `/gamma` declares no `base`, calls one helper, and fetches only
`VENDOR_API` — and still collects `fitness.example.com` from a function it does
not call.

That is a different defect from the name collision, and this commit does not
address it. `mutate-provenance-shadowing.mjs` **reports it and does not gate on
it**, because a red nobody can turn green is a red everyone learns to skip.

Whoever takes it: the fixture is in that harness, three routes, reproduces in
under a second.

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
