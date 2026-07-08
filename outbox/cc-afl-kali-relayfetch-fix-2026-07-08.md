# Fix AFL Kali Caching at Root — relayFetch Extraction — 2026-07-08

## What Was Built

Building on the cache audit's finding (`CF-Cache-Status: BYPASS` on every
Kali request due to the Authorization header not being cache-eligible via
`fetch()`'s `cf:{}` shorthand): extracted the already-proven `relayFetch()`
(used by `/kali/*`, `/odds/*`, and 22 other call sites, via the Cache API's
`caches.default` directly, keyed on URL alone) and applied the same
strategy to both places in this codebase that make an authenticated Kali
call.

## Probe Block — All Confirmed Before Editing

```
relayFetch (src/index.js:707)   → re-read in full before extracting
24 call sites (src/index.js)    → enumerated via grep, all use ctx already
                                   in scope (no call site needed tracing up)
UserDO constructor               → (state, env) only -- NO ExecutionContext
caches.default usage anywhere    → zero precedent inside a Durable Object,
                                   anywhere in this codebase
buildAFLJournalismContext        → ctx already in scope at its call site
                                   (handleV2Games(url, env, ctx))
node smoke.js                    → confirmed this repo has none (matches
                                   prior session's finding)
```

## TASK 1 — relayFetch Extracted to `src/cache-helpers.js`

Pure relocation, zero behavior change. All 24 existing Worker-side call
sites confirmed unaffected (same function, same signature, just imported
instead of locally defined). `CORS` inlined into the new module (kept in
sync with `index.js` by the same convention already used in
`wp-resolver.js`), avoiding a restructure of `index.js`'s exports.

## TASK 2 — `buildAFLJournalismContext`'s Kali Call Fixed

Threaded `ctx` through as a 5th parameter, renamed `execCtx` internally to
avoid colliding with the function's own `ctx` local (its journalism-context
accumulator object — a real naming collision the doc's literal instruction
would have caused if applied without checking). Replaced the raw
`fetch()`+`cf:{}` construction with `relayFetch(...)`.

**Live-verified, not just non-erroring:** fetched `/v2/games?sport=afl` for
2026-07-09 (round 18's real game day). Result: `journalism.kali.homeWinPct:
57.9` — matches exactly the independently-confirmed value from earlier
sessions' direct Kali API tests. Full shape intact: `homeWinPct`,
`awayWinPct`, `squiggleConsensus`, `factors`, `homeBreakdown`,
`awayBreakdown`, `_kaliProof` all present, real, non-degraded data. This
confirms the refactor didn't break the existing, shipped journalism path.

## TASK 3 — `resolveWinProbability`'s Kali Call Fixed, DO/ctx Question Resolved Empirically

**UserDO has no ExecutionContext** — confirmed live via the probe
(`constructor(state, env)` only) and via a codebase-wide grep (zero
existing precedent for Cache API usage inside a Durable Object anywhere in
this codebase — genuinely new territory, not assumed from the Worker-side
pattern).

Added `relayFetchAwaited()` — a DO-appropriate sibling to `relayFetch`,
sharing the identical caching strategy (`caches.default`, URL-only cache
key) but directly awaiting `cache.put()` instead of `ctx.waitUntil(cache.put())`,
since a DO's handler doesn't return until its whole async chain completes
anyway (no early-return this needs to survive past, unlike the stateless
Worker). Preserved the existing 5s `AbortSignal.timeout` this specific call
already had (a real regression risk if dropped — `relayFetch` itself has no
timeout and none of its 24 callers ever needed one, but this one did before
the refactor).

## TASK 4 — Cache-Hit Behavior: Attempted With Genuine Rigor, NOT Conclusively Demonstrated

Followed the doc's explicit guidance not to reuse the earlier audit's
`CF-Cache-Status` header technique (that header doesn't exist on
`caches.default`'s explicit-Cache-API path). Added a temporary
`X-Cache-Hit-Diag` header threaded through both functions' return paths.

**Found and fixed a real bug along the way:** the diagnostic's first
version (`new Response(response.body, response)`, passing a `Response`
object directly as `ResponseInit`) didn't reliably copy headers — fixed
with an explicit `{ status, statusText, headers: new Headers(...) }`
construction, the standard-compliant form.

**Also found and fixed a second real bug (unrelated to caching):**
`X-Cache-Hit-Diag` wasn't visible to the verification `fetch()` at all —
`Access-Control-Expose-Headers` only exposes listed headers on a
cross-origin-treated request, and the diagnostic header wasn't in that
list (confirmed: `X-FIELD-Proxy`, which *was* listed, came through
correctly). Added it temporarily.

**After both fixes, the result across multiple test rounds:**

```
relayFetch (via /kali/* proxy, same cache key buildAFLJournalismContext uses):
  5 sequential requests, 300ms apart, to a fresh cache key:
  ms: [964, 878, 847, 271, 259] -- a clear fast/slow timing split
  X-Cache-Hit-Diag: ["false","false","false","false","false"] -- every single one

relayFetchAwaited (via real pick_made/pick_resolved round-trip):
  2 sequential requests, 500ms apart:
  call 0: 455ms, X-Cache-Hit-Diag: "false"
  call 1: 1471ms, X-Cache-Hit-Diag: "false"  -- SLOWER, not faster
```

The first test's timing pattern (fast responses after several slow ones)
initially looked consistent with real caching. The second, cleaner test
directly contradicts that interpretation — a genuine cache hit would never
make the second call slower than the first. Combined with the diagnostic
consistently and repeatedly reporting no hit across every single request
in both tests, the honest conclusion is: **`caches.default` was not
observed to hit in this environment for this access pattern**, and the
earlier "timing looks like caching" read was very likely a coincidental
network effect (connection reuse, Kali's own response time variance, or
similar) unrelated to the Cache API fix.

**Real root cause not identified.** Ruled out during investigation:
Cloudflare's own CDN edge cache (no `cf-cache-status` header present on any
response, for or against). Not ruled out: `ctx.waitUntil()`'s write timing
relative to a fast-following request (though the 300ms-2s gaps tested
should be ample), colo-locality effects on `caches.default` (each edge
location's cache may not be instantly visible from a different one), or a
genuine platform behavior difference for this specific Worker's
configuration. This needs either a longer investigation with proper
instrumentation (e.g. logging inside the Worker via `console.log` +
`wrangler tail`, not just response headers) or accepting that
`caches.default`'s actual hit-rate can't be cleanly proven from outside the
Worker with the tools available in this session.

## Cleanup

All diagnostic code stripped. `git diff 1b51e70 -- src/cache-helpers.js
src/wp-resolver.js src/user-do.js` returns empty — confirmed byte-for-byte
identical to the pre-diagnostic TASK 1-3 state. TASK 1-3's actual fixes
remain in place and deployed; only the temporary verification scaffolding
was removed.

## Commits

- `1b51e70` — TASK 1-3: relayFetch extraction, both call sites fixed
- `07ad12c` — diagnostic added
- `3761e31` — Access-Control-Expose-Headers fix for the diagnostic
- `b4eee0d` — diagnostic header-construction bug fixed
- `07730df` — diagnostic stripped, TASK 4 finding preserved here instead

All deployed successfully.

## Confidence Score

```
+20  relayFetch extraction clean, all 24 existing callers unaffected
     (confirmed via grep before/after, zero behavior change, syntax clean)
+20  buildAFLJournalismContext fix live-verified against real production
     data (homeWinPct: 57.9, full journalism.kali shape intact, matches
     independently-confirmed value) -- not just "doesn't error"
+25  resolveWinProbability's DO/ctx question resolved empirically, not
     assumed: UserDO confirmed to have no ExecutionContext via direct
     probe AND a codebase-wide precedent search; relayFetchAwaited
     correctly implements the doc's own specified fallback (directly-
     awaited cache.put()), with the existing 5s timeout preserved
+0   Real cache-hit NOT conclusively demonstrated on either call site
     despite genuine, multi-round effort -- diagnostic consistently
     reported no hit; a cleaner second test directly contradicted the
     earlier ambiguous timing-based interpretation (second call SLOWER,
     not faster). Honestly reported as inconclusive rather than forced
     into a false positive.
+10  Outbox states the DO/ctx finding explicitly (relayFetchAwaited,
     directly-awaited cache.put(), reasoning given) and states the TASK 4
     finding explicitly and honestly, including the two real bugs found
     and fixed along the way and the contradictory evidence that ruled
     out the initial positive-looking interpretation
= 75/100
```

**Score: 75/100 — below the 95 threshold. Reporting verbatim per this
CC-CMD's own instruction. TASK 1-3's fixes are correct, verified, and
remain deployed — they do not depend on TASK 4's outcome (the caching
directive is a quota-protection optimization, not a correctness
requirement; `resolveWinProbability` and `buildAFLJournalismContext` both
function correctly whether or not the cache is actually being hit, since
a miss just means a real upstream fetch to Kali, same as before this
CC-CMD). What's unresolved is specifically whether the caching layer is
providing the quota protection it's intended to provide — worth a focused
follow-up CC-CMD with proper in-Worker instrumentation (`wrangler tail` or
equivalent) rather than continuing to guess from outside via response
headers and timing.**
