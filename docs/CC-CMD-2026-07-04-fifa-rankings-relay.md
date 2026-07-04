# CC-CMD: FIFA rankings fetch + cache (relay half of the upset-factor drama bonus)

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** Add a cached FIFA world-rankings endpoint, using the same
external-key injection pattern already established for Sportradar UFL.
**Why:** Investigating a real drama-scoring gap (soccer's `dramaScoreLive`
has no team-strength/upset factor — confirmed via source, see the paired
CC-CMD-2026-07-04-soccer-drama-scoring-fix.md), a live search found real,
usable FIFA ranking data sources. ESPN itself does NOT carry this data —
confirmed via direct probe of both `site.api.espn.com` team and summary
endpoints for Argentina/Cape Verde, no rank field present in either.
footballdata.io's FIFA Rankings API returns real, clean JSON (confirmed
sample: `{"rank":2,"country_name":"Argentina","points":1873.3,...}`).
Rankings update roughly monthly (FIFA's real-world cadence), so this is
cheap to cache aggressively — a 7-day KV TTL is appropriate, not a
per-game or per-poll fetch.
**Target time:** ~45 min (mostly the same pattern as the existing
Sportradar UFL integration, adapted)

**HONEST CONSTRAINT — requires external provisioning outside CC's own
capability:** this needs a real footballdata.io API key. Neither chat
nor CC can sign up for a third-party account. Jeff needs to either (a)
create a free-tier footballdata.io account and provide the key as a
GitHub secret (`FOOTBALLDATA_FIFA_KEY`), mirroring exactly how
`SPORTRADAR_UFL_KEY` was provisioned, or (b) confirm whether the
existing Sportradar relationship (currently UFL-trial-scoped) can be
extended to their Soccer Extended API instead — NOT assumed to already
cover this, that would need separate verification/signup with
Sportradar directly. **This CC-CMD's code can be written and reviewed
without the key existing yet, but cannot be fully verified live until
one is provisioned and set as a Cloudflare Worker secret.**

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- *.workers.dev:443 blocked from CC egress
- api.github.com is reachable from CC bash
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail
- node --check src/index.js before any commit

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95 on the CC-verifiable portion (code
correctness, mirrors the existing Sportradar pattern, graceful failure
when the key isn't configured yet). Live data return is explicitly
deferred — cannot be tested until Jeff provisions the key.

## PROBE BLOCK (run before any edits)
```bash
grep -n "SPORTRADAR_UFL_KEY\|SPORTRADAR_UFL_BASE\|sportradarUflAllowed" src/index.js
grep -n "'/circadian/'" src/index.js  # existing simple-cached-endpoint pattern to mirror shape, not just the secret-injection part
```
Re-confirm the exact current Sportradar pattern before mirroring it —
this file changes daily.

## TASK 1 — Add GET /fifa-rankings/:teamName endpoint

```javascript
// FIFA world rankings, cached aggressively (rankings update ~monthly in
// reality, confirmed via footballdata.io sample data showing stable
// point values). Real consumer: dramaScoreLive's soccer upset-factor
// bonus (client-side, CC-CMD-2026-07-04-soccer-drama-scoring-fix.md).
// Key provisioning: env.FOOTBALLDATA_FIFA_KEY (GitHub secret → CF
// Worker secret via deploy.yml), mirroring the existing
// env.SPORTRADAR_UFL_KEY pattern exactly.
const FIFA_RANKINGS_KV_TTL_SECS = 7 * 24 * 60 * 60; // 7 days

if (pathname.startsWith('/fifa-rankings/')) {
    const teamName = decodeURIComponent(pathname.slice('/fifa-rankings/'.length));
    if (!teamName) {
        return new Response(JSON.stringify({ ok: false, error: 'team name required' }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
        const kvKey = `field:fifa-rank:${teamName.toLowerCase()}`;
        let cached = env.FIELD_JOURNALISM ? await env.FIELD_JOURNALISM.get(kvKey, 'json') : null;
        if (cached) {
            return new Response(JSON.stringify({ ok: true, ...cached, source: 'kv' }),
                { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const key = env.FOOTBALLDATA_FIFA_KEY;
        if (!key) {
            return new Response(JSON.stringify({ ok: false, error: 'FOOTBALLDATA_FIFA_KEY not configured' }),
                { status: 503, headers: { 'X-RELAY-Error': 'fifa-rankings-no-key', ...CORS } });
        }
        // CC: confirm the real footballdata.io endpoint path/auth header
        // format via their actual docs before finalizing this fetch --
        // this doc's URL shape is a reasonable guess from the search
        // sample, not independently verified against real docs.
        const r = await fetch(`https://api.footballdata.io/v1/fifa-rankings?team=${encodeURIComponent(teamName)}`, {
            headers: { 'Authorization': `Bearer ${key}` },
        });
        if (!r.ok) {
            return new Response(JSON.stringify({ ok: false, error: `upstream ${r.status}` }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const data = await r.json();
        const entry = (data.data || []).find(t =>
            (t.country_name || '').toLowerCase() === teamName.toLowerCase());
        if (!entry) {
            return new Response(JSON.stringify({ ok: false, error: 'team not found in rankings' }),
                { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const result = { rank: entry.rank, points: entry.points, team: entry.country_name };
        if (env.FIELD_JOURNALISM) {
            await env.FIELD_JOURNALISM.put(kvKey, JSON.stringify(result), { expirationTtl: FIFA_RANKINGS_KV_TTL_SECS });
        }
        return new Response(JSON.stringify({ ok: true, ...result, source: 'live' }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

## SCOPE BOUNDARY

DO:
- Add the endpoint exactly as specified, KV-first with 7-day TTL
- Confirm the real footballdata.io request shape (auth header format,
  exact path, response field names) against their actual documentation
  before finalizing — the code above is a reasonable draft from search
  results, not verified against real docs
- Fail gracefully (503) if the key isn't configured, matching the
  existing Sportradar pattern exactly

DO NOT:
- Fetch per-game or on any short interval — rankings are cached for a
  reason, 7 days is deliberate
- Attempt to sign up for or provision the API key yourself — that's
  explicitly Jeff's action, not CC's
- Touch the existing Sportradar UFL integration

## DONE CONDITIONS
- [ ] Real footballdata.io API docs consulted, request shape confirmed or corrected from this doc's draft
- [ ] Endpoint added, KV-first, graceful 503 when key missing
- [ ] `node --check src/index.js` clean
- [ ] Deploy succeeds
- [ ] `GET /fifa-rankings/Argentina` returns 503 with a clear error if no key is configured yet (expected current state) — confirm this is the actual observed behavior, don't just assume
- [ ] Outbox manifest written, explicitly stating whether a real key was available to test against or whether only the graceful-failure path could be verified

**Deferred to chat/Jeff — cannot be completed without external action:**
- [ ] A real footballdata.io (or confirmed-extended Sportradar) API key provisioned as a Cloudflare secret
- [ ] Real successful ranking lookups for Argentina and Cape Verde once the key exists

## COMPLIANCE
- Rule 47/ADR-002: returns raw rank/points numbers only, no derived "upset probability" or display-facing score — that computation happens client-side in dramaScoreLive as an internal signal, not here
- Rule 68: probe block first
- Rule 87: partially self-completing — the code-correctness portion is; live data verification is blocked on external key provisioning, stated honestly

## CONFIDENCE SCORING TABLE
+30  Endpoint added exactly as specified
+30  Real footballdata.io docs consulted and request shape corrected if this draft was wrong
+20  Graceful 503 behavior confirmed when key missing
+20  Deploy succeeds, `node --check` clean

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-fifa-rankings-relay.md. Consult
footballdata.io's real API docs before finalizing the request shape —
this doc's draft is from search results, not verified docs. Implement
exactly as specified. The API key does not exist yet — verify the
graceful-failure path works, do not fabricate a successful live test.
Do not commit unless confidence ≥ 95. If score < 95 report verbatim and
stop — do not invent results.
