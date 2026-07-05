# CC-CMD: Rule 78 rate-limit guard for /cfl/scoreboard/rounds — prerequisite for recurring CFL polling

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** One outbound `fetch()` options object. No logic/routing changes.

**Why — real, confirmed gap, not theoretical.** This is the Rule 78
(API-COST-A) probe requested before building recurring client-side CFL
polling (open item since the 2026-07-05 session close: "CFL picks can
only resolve after page reload, not live mid-session").

Findings from the probe, each independently verified against current
HEAD (`ed80885`), not assumed:

1. **No official rate limit exists** for `cflscoreboard.cfl.ca` — it's
   an unofficial endpoint (confirmed via the code's own comment: "Used
   by ha-teamtracker v0.17.4 (May 2026). Refresh 30s live, 10min
   pre/post." — that reference client's cadence is the only known-safe
   baseline that exists).
2. **Grepped every other external-API call site in this file** (`grep
   -n "cacheTtl\|cacheEverything" src/index.js`) — 17+ call sites all
   use the same established pattern: `cf: { cacheTtl: N, cacheEverything:
   true }`. A 30s TTL is already used elsewhere in this file for another
   live-score source (line ~3391), matching exactly the cadence CFL
   needs.
3. **The `/cfl/scoreboard/rounds` handler (line ~9010) is the one
   outbound fetch in this entire file that does not follow this
   pattern.** It sets `Cache-Control: public, max-age=30` on its own
   *response* (which governs client/browser caching of repeat requests
   to the relay), but the outbound `fetch()` to `cflscoreboard.cfl.ca`
   itself has no `cf.cacheTtl` — so every request that reaches the
   relay's handler triggers a fresh live call upstream, regardless of
   how many happened in the prior 30 seconds. Once client-side recurring
   polling exists, this becomes N concurrent users × 1 upstream call
   each, unthrottled.

This CC-CMD closes only the caching gap. It does **not** add the
client-side recurring poll itself — that's a separate, client-repo
CC-CMD, gated on this one being deployed and verified first (per Rule
87 — no carry-forwards without a second CC-CMD to handle them; this
comment IS that second CC-CMD's dependency, named explicitly).

**Target time:** ~10 min

## PROBE BLOCK
```bash
grep -n "cflscoreboard.cfl.ca/json/scoreboard/rounds.json" -A 8 src/index.js
```
Confirm the current handler still matches the citation above before
editing — no `cf:` option on the `fetch()` call.

## TASK 1 — Add the established caching pattern to the outbound fetch

In the `/cfl/scoreboard/rounds` handler, change:
```javascript
const sbResp = await fetch('https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json', {
    headers: { 'User-Agent': '...' },
    signal: AbortSignal.timeout(6000),
});
```
to:
```javascript
const sbResp = await fetch('https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json', {
    headers: { 'User-Agent': '...' },
    signal: AbortSignal.timeout(6000),
    cf: { cacheTtl: 30, cacheEverything: true },
});
```
30s matches both the existing sibling pattern at line ~3391 and the
reference client's own documented live-refresh cadence — do not
lower it without a stated reason.

Leave the `/cfl/scoreboard/squads` handler (10min TTL data, low
churn) alone unless it's found to have the same gap — check it in the
probe block too and fix it identically if so, since it's the same class
of bug (same file, same missing pattern), not a new scope.

## TASK 2 — Verify the cache is real, not just declared

Cloudflare's `cf.cacheTtl` doesn't surface via response headers by
default. Verify behaviorally: hit `/cfl/scoreboard/rounds` twice within
30s from the sandbox/CI and confirm response bodies are byte-identical
AND confirm via Cloudflare's analytics/logs (or a temporary diagnostic
log of upstream fetch count) that only one real upstream call happened,
not two. If this can't be confirmed live within the session, report
that gap honestly rather than assuming the `cf` option worked.

## DONE CONDITIONS
- [ ] Probe block confirms current state (no `cf:` option present)
- [ ] `cf: { cacheTtl: 30, cacheEverything: true }` added to the rounds fetch
- [ ] Squads handler checked; fixed identically if the same gap exists
- [ ] Real behavioral verification that the upstream call is actually throttled, or the gap honestly reported
- [ ] Outbox manifest written

## CONFIDENCE SCORING TABLE
+40  Caching option added correctly, matching the established sibling pattern exactly
+20  Squads handler checked and fixed if needed
+30  Real behavioral verification the upstream fetch is throttled (not just YAML/code-level trust)
+10  If verification couldn't complete in-session, reported honestly

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-cfl-scoreboard-cache-guard.md.
Add `cf: { cacheTtl: 30, cacheEverything: true }` to the
/cfl/scoreboard/rounds outbound fetch (and squads handler if it has the
same gap) -- this is the Rule 78 rate-limit guard needed before
recurring client-side CFL polling can be built safely. Verify the
upstream call is actually throttled, not just that the code compiles.
Do not commit unless confidence >= 95. If score < 95 report verbatim and stop.
