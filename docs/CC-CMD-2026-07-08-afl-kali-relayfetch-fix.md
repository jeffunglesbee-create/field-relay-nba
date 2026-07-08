# CC-CMD: Fix AFL Kali caching at its root — extract relayFetch, apply to both call sites

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

Live-diagnosed (CC-CMD-2026-07-08-afl-kali-cache-audit, commits
6f76984/cdbc2a5): `resolveWinProbability`'s Kali fetch returns
`CF-Cache-Status: BYPASS` on every request despite `cf: {cacheTtl:3600,
cacheEverything:true}` being present. Root cause: the request carries an
`Authorization` header, which Cloudflare does not cache by default —
`cacheEverything` does not override this. `cf:{}` on a `fetch()` is an
*implicit* cache that silently no-ops here; it is not a bug in the TTL
number or the cache key, it's a category mismatch between the mechanism
and an authenticated request.

**This is not scoped to the new code.** `buildAFLJournalismContext`
(`src/index.js`, live since 2026-06-26) has the *identical* pattern on
its own Kali call — same `Authorization` header, same inline `cf:{}`.
This function runs on every AFL schedule/journalism page load across all
users, far more frequently than per-pick resolution. It has almost
certainly been bypassing cache the same way since it shipped. This
CC-CMD fixes both call sites, not just the one this session happened to
be looking at — per Rule 89's Pipeline Sweep radius: the same
underlying gap, fixed once, not twice.

**The real fix already exists in this codebase.** `relayFetch()`
(`src/index.js`, used by the `/kali/*` and `/odds/*` proxy routes)
solves exactly this problem: it uses the Cache API directly
(`caches.default`), with a cache key built from `new Request(targetUrl,
{method:'GET'})` — **no headers in the key, no headers in the cached
Response**. The Authorization header is only ever used for the single
upstream fetch on a genuine cache miss. This sidesteps Cloudflare's
auth-header restriction entirely rather than fighting it. Reuse this,
don't invent a new mechanism.

**buildAFLJournalismContext's Squiggle call is explicitly out of
scope** — confirmed via `SQUIGGLE_HEADERS` (`Accept`/`User-Agent` only,
no Authorization) that Squiggle isn't subject to this restriction. Do
not touch the Squiggle branch in either file.

**Real, unresolved uncertainty — do not pattern-match past this:**
`relayFetch(targetUrl, headers, ttl, source, ctx)` takes `ctx` for
`ctx.waitUntil(cache.put(...))`. That `ctx` is the main Worker's
`ExecutionContext`, available in `index.js`'s fetch handler.
`resolveWinProbability` is also called from `user-do.js`'s
`pick_resolved` handler, inside a Durable Object — **it is not yet
confirmed whether UserDO has an equivalent `ctx`, or whether
`caches.default` behaves identically inside a DO's execution model.**
The probe block below must establish this empirically before writing
any DO-side caching code. If UserDO has no `ctx.waitUntil` equivalent,
the correct adaptation is a directly-awaited `cache.put()` (blocking is
fine here — the DO's handler doesn't return until this async chain
completes anyway, unlike the stateless Worker where `waitUntil` exists
specifically to extend life past an early response). Do not assume the
Worker-side signature ports unchanged; prove it either way.

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "async function relayFetch" src/index.js
sed -n '/async function relayFetch/,/^}/p' src/index.js
# Re-confirm the exact current implementation before extracting it —
# this doc's citation above may already be stale.

grep -rn "relayFetch(" src/*.js
# Enumerate every current call site (expected: /kali/* and /odds/*
# proxy routes in index.js) so none get silently broken by the extraction.

grep -n "class UserDO" -A5 src/user-do.js
grep -n "constructor(state, env" src/user-do.js
# Does UserDO's constructor receive anything resembling an
# ExecutionContext, or only (state, env)? This determines whether
# ctx.waitUntil is available at all inside pick_resolved.

grep -n "caches\.default\|caches\[" src/*.js
# Any existing precedent for Cache API usage from inside a DO,
# anywhere in this codebase? If none exists, this is genuinely new
# territory for a DO context and needs live verification, not
# assumption from the Worker-side precedent alone.

grep -n "buildAFLJournalismContext(games" src/index.js
# Confirm the current call site's exact signature and whether ctx is
# already in scope at that call site (handleV2Games or wherever it's
# invoked) even though it isn't currently passed through.

node smoke.js 2>&1 | tail -5 || echo "(confirm actual test/verification command for this repo before assuming none exists)"
```

## TASK 1 — Extract relayFetch into its own shared module

Create `src/cache-helpers.js` (not `budget-helpers.js` — that file is
scoped specifically to Odds-API quota counting via KV counters, a
different concern from response caching via the Cache API; mixing them
violates this codebase's established one-file-one-concern convention,
visible in budget-helpers.js's own docstring).

Move `relayFetch` there verbatim from its probe-confirmed current form.
Export it. Update `index.js` to `import { relayFetch } from
'./cache-helpers.js'` instead of defining it locally. Confirm every
existing call site (from the probe block's enumeration) still resolves
correctly — this is a pure relocation, zero behavior change, for the
Worker-side callers.

## TASK 2 — Fix buildAFLJournalismContext's Kali call (src/index.js)

Replace the raw `fetch(...)` + inline `cf:{}` Kali call with
`relayFetch(url, headers, 3600, 'kali-journalism', ctx)`. This requires
threading `ctx` through `buildAFLJournalismContext`'s own signature
(currently `(games, round, year, env)` — add `ctx` as a 5th parameter)
and through its call site — confirmed via the probe block whether `ctx`
is already in scope there. If it isn't, trace up the call chain until
it is; do not fabricate a `ctx`-like object.

**This touches a widely-used, already-shipped production path serving
every AFL journalism display.** Regression risk here is real, not
theoretical. After the change, verify `/v2/games?sport=afl` still
returns correctly-shaped `journalism.kali` data for a live pre-game
fixture — not just that it doesn't error, that the actual data is
present and correctly formed, same as before the change.

## TASK 3 — Fix resolveWinProbability's Kali call (src/wp-resolver.js)

Same replacement, but **only after the probe block has established
whether UserDO has a usable `ctx`**. If yes, thread it through the same
way as index.js's call chain (`resolveWinProbability` → `_discoverAFLRound`
already shows this pattern isn't used, but the Kali fetch itself is a
different call site). If no usable `ctx.waitUntil` exists in the DO
context, use a directly-awaited `cache.put()` in place of
`ctx.waitUntil(cache.put(...))` — state explicitly in the outbox which
path was taken and why, based on the probe's actual finding, not
inferred from the Worker-side precedent.

## TASK 4 — Live verification of actual cache-hit behavior, both call sites

Mirror the exact diagnostic methodology already proven in
CC-CMD-2026-07-08-afl-kali-cache-audit (temporary `CF-Cache-Status`
threading via `cache.match()`'s result presence, not the upstream
header — `caches.default` hits don't carry the upstream
`CF-Cache-Status` header at all, the fact that `cache.match()` returned
a non-null Response IS the hit signal; do not assume the same
diagnostic mechanism ports unchanged, verify what signal is actually
observable through this new path before claiming success). Confirm a
second call within the TTL window for the same round is served from
`caches.default`, not a fresh upstream fetch, for **both** the
`buildAFLJournalismContext` path and the `resolveWinProbability` path
independently — a hit on one does not prove the other.

## DONE CONDITIONS

- [x] `relayFetch` extracted to `src/cache-helpers.js`, all existing
      call sites (`/kali/*`, `/odds/*`) still function identically
- [x] `buildAFLJournalismContext`'s Kali call uses `relayFetch`, `ctx`
      correctly threaded from a real source, not fabricated
- [x] Live-verified `/v2/games?sport=afl` journalism data unchanged in
      shape/correctness after the refactor
- [x] `resolveWinProbability`'s Kali call uses `relayFetch` or a
      DO-appropriate equivalent, with the ctx/waitUntil question
      resolved empirically and stated explicitly in the outbox
- [x] Actual cache-hit behavior demonstrated for both call sites
      independently, not assumed from one working
- [x] Squiggle calls in both files confirmed untouched

## CONFIDENCE SCORING

- +20 — relayFetch extraction clean, all existing callers unaffected
- +20 — buildAFLJournalismContext fix live-verified, no regression to
  existing journalism display
- +25 — resolveWinProbability fix correctly handles the DO ctx question
  based on actual probe findings, not assumption
- +25 — real cache-hit demonstrated on both call sites independently
- +10 — outbox states the DO/ctx finding explicitly either way

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-afl-kali-relayfetch-fix.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
