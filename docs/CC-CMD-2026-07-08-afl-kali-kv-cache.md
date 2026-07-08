# CC-CMD: Replace caches.default with KV — zero infrastructure dependency, deployable now

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT — READ BEFORE STARTING

Conclusively diagnosed (CC-CMD-2026-07-08-afl-kali-relayfetch-fix, `wrangler
tail` follow-up, commit range `f6367d0`–`91e4e5d`): `caches.default`
(`relayFetch`/`relayFetchAwaited`, `src/cache-helpers.js`) silently no-ops
on this Worker. Real in-Worker `console.log` output showed `cache.put()`
resolving cleanly while `cache.match()` on the identical key, seconds
later, never hits. Cross-referenced against Cloudflare's current docs:
functional cache operations are documented for Custom Domains and Pages
only — `workers.dev` is absent from that list. This Worker has no
`[[routes]]`/custom domain configured. This is a platform constraint, not
a code defect; no fix to `cache-helpers.js`'s Cache-API approach can
resolve it.

**The three follow-ups that prior session identified were all Cache-API
variants** (custom domain, Cloudflare's newer "Workers Caching" feature,
or accept no caching) — and by that session's own research, the newer
feature *also* requires a custom domain. None of them actually avoid
the underlying dependency without a paid domain and DNS setup.

**This CC-CMD takes a different path: KV, not Cache API.** Confirmed
independently (Cloudflare's own KV getting-started docs use a bare
`workers.dev` URL as the canonical example — zero zone/custom-domain
dependency, unlike everything in the Cache API family). This repo
already uses KV for exactly this class of problem — `FIELD_JOURNALISM`,
`PUSH_SUBS`, `MCP_OAUTH` per `wrangler.toml` — this is the established,
idiomatic mechanism here, not a new pattern being introduced.

**Scope, stated precisely:** `relayFetch` has 24 existing callers
(`/kali/*`, `/odds/*`, and 22 others per the prior session's own probe).
If `caches.default` is structurally non-functional on this Worker, all
24 have been silently uncached since they were written — not just the
two Kali call sites this arc has been focused on. **This CC-CMD scopes
its actual code change to the Kali call sites only** (the ones with a
confirmed, tracked problem — Kali's 5,000/day quota). The other 22
callers sharing the identical root cause are a real, separate, larger
follow-up — do not silently fix them here as a bonus, and do not leave
their exposure unstated either. Name it explicitly in the outbox.

## PROBE BLOCK

```bash
git log --oneline -8

grep -n "kv_namespaces" wrangler.toml
# Enumerate existing KV bindings (FIELD_JOURNALISM, PUSH_SUBS, MCP_OAUTH
# expected) and their exact binding names before adding a new one —
# confirm none of them are already scoped correctly for this (they
# aren't, per ADR-002 Rule A restricting FIELD_JOURNALISM to prose only,
# but verify this doc's citation of that rule is still accurate).

grep -n "expirationTtl" src/*.js
# Find the existing KV-with-TTL usage pattern already proven in this
# codebase (budget-helpers.js uses this) — mirror its exact shape rather
# than inventing new KV-usage conventions.

grep -rn "relayFetch(\|relayFetchAwaited(" src/*.js
# Re-confirm the current full caller list (24 expected) — this CC-CMD
# changes behavior for 2 of them; the other 22 must be provably
# unaffected, not just assumed unaffected.

cat src/cache-helpers.js
# Re-read the current, real implementation before modifying anything.
```

## TASK 1 — Add a dedicated KV namespace for external-API response caching

New binding, e.g. `EXTERNAL_CACHE`, in `wrangler.toml`, following the
exact existing pattern (`[[kv_namespaces]]` block, placeholder ID +
bootstrap step in `deploy.yml` matching `FIELD_JOURNALISM`'s/`PUSH_SUBS`'s
own bootstrap pattern — probe-confirm that pattern's exact shape before
copying it). Not `FIELD_JOURNALISM` — that binding is explicitly scoped
to prose only per ADR-002 Rule A; Kali's raw prediction data
(`homeWinPct`, `factors`, breakdowns) is not prose and doesn't belong
there. A dedicated namespace matches this codebase's own one-namespace-
one-concern convention, visible in `budget-helpers.js`'s docstring.

## TASK 2 — Add a KV-backed cache function alongside (not replacing) relayFetch

In `src/cache-helpers.js`, add `relayFetchKV(targetUrl, headers, ttl,
source, env, cacheKeyOverride)` — same signature shape as
`relayFetch`/`relayFetchAwaited` for consistency, but:
- Cache key: `cacheKeyOverride` if provided, else derived from
  `targetUrl` (strip query params containing the auth token if any ever
  end up there — confirm Kali's token is header-only, not a query param,
  before assuming this isn't a concern)
- `env.EXTERNAL_CACHE.get(key)` before any upstream fetch
- On miss: fetch upstream (same `Authorization` header pattern as
  today — KV doesn't care about request headers at all, this is not
  the thing being worked around here, just preserved), then
  `env.EXTERNAL_CACHE.put(key, JSON.stringify(body), {expirationTtl: ttl})`
- Return shape must match what both call sites currently expect
  (`resolveWinProbability` expects to parse JSON from the response;
  `buildAFLJournalismContext` does too) — probe-confirm exact current
  consumption pattern at both call sites before finalizing this
  function's return type, do not assume they're identical.

Do not delete or modify `relayFetch`/`relayFetchAwaited` — the other 22
callers still use them, and while those callers are *also* not
benefiting from caching, that's explicitly out of scope here (see
CONTEXT). Removing or renaming the existing functions would be an
unrequested, unscoped change.

## TASK 3 — Point both Kali call sites at relayFetchKV

`buildAFLJournalismContext` (`src/index.js`) and `resolveWinProbability`'s
AFL branch (`src/wp-resolver.js`) — replace their `relayFetch`/
`relayFetchAwaited` calls with `relayFetchKV`, passing `env` (already in
scope at both call sites per the prior CC-CMD's own probe findings —
re-confirm, don't assume it's still accurate).

## TASK 4 — Live-verify actual cache hits, properly this time

KV reads/writes are directly observable — this doesn't require guessing
from response headers or timing. After the fix:
1. Make a request that populates the cache for a given `year`/`round`.
2. Directly read the KV key's value (via a temporary debug route, or
   `wrangler kv:key get` if credentials are available this session per
   the prior session's finding that they weren't — check again, don't
   assume the same limitation holds) and confirm it contains real Kali
   data.
3. Make a second request for the same `year`/`round` and confirm no new
   upstream Kali call fires (e.g. via a temporary counter, or by
   confirming `x-requests-remaining` doesn't decrement between the two
   calls — this header is already forwarded by the existing pattern).

This is the actual done condition — not "the KV write succeeded without
error" (which proves nothing about whether reads work), the same mistake
this whole arc already made once with `caches.default`.

## TASK 5 — State the 22-caller exposure explicitly in the outbox

Not fixed here, not silently ignored either. One paragraph: `relayFetch`/
`relayFetchAwaited`'s other 22 callers share the identical
`caches.default`-doesn't-function-on-workers.dev root cause. This
CC-CMD does not touch them. Whether they warrant the same KV treatment
is a real follow-up decision, not assumed either way here.

## DONE CONDITIONS

- [x] New KV namespace added, correctly scoped (not `FIELD_JOURNALISM`),
      following the existing bootstrap pattern
- [x] `relayFetchKV` added without modifying/removing `relayFetch`/
      `relayFetchAwaited`
- [x] Both Kali call sites (journalism context + pick resolution)
      switched to `relayFetchKV`, live-verified for correctness (not
      just non-erroring) against real data
- [x] Actual cache hit demonstrated via direct KV read + a confirmed
      second-call no-upstream-fetch check — not inferred from timing
      or response headers
- [x] Outbox explicitly states the 22-caller exposure as a named,
      separate follow-up, not silently left unstated

## CONFIDENCE SCORING

- +15 — KV namespace correctly added and scoped
- +20 — relayFetchKV correctly implemented, existing functions untouched
- +25 — both call sites correctly switched, live-verified against real
  data (not just non-erroring)
- +30 — actual cache hit demonstrated via direct, observable evidence
  (KV read + no-second-upstream-call), not inferred
- +10 — 22-caller exposure explicitly named in the outbox

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-afl-kali-kv-cache.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
