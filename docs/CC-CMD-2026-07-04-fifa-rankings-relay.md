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

**UPDATE 2026-07-04: a real footballdata.io API key has been generated**
(confirmed via screenshot of their dashboard — key creation succeeded,
"0% used, has not been used yet"). What remains true and unverified:
(a) the key has NOT yet been confirmed set as a Cloudflare Worker secret
(`FOOTBALLDATA_FIFA_KEY`) — that step still needs to happen, via
`wrangler secret put FOOTBALLDATA_FIFA_KEY` or the Cloudflare dashboard,
mirroring exactly how `SPORTRADAR_UFL_KEY` was provisioned; (b) the key
has NOT been live-tested against the real endpoint from any environment
that can reach `footballdata.io` — chat's own sandbox has this domain
blocked from egress (confirmed: "Host not in allowlist: footballdata.io"),
so this must be verified either from within the deployed Worker itself
(which CAN reach arbitrary external hosts) or from an environment with
that domain allowlisted. **The raw key value must never be pasted into
this file, any commit, or any CC-CMD — only the env var name
`FOOTBALLDATA_FIFA_KEY` is referenced here.**

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

## TASK 1 — Add GET /fifa-rankings/:teamName endpoint (VERIFIED design — corrected 2026-07-04)

**Verified directly against footballdata.io's own docs (not the earlier
guessed draft):** the real endpoint is `GET https://footballdata.io/api/v1/fifa-rankings?type=men`
(or `type=women`) — base domain is `footballdata.io`, NOT `api.footballdata.io`,
and it returns the ENTIRE rankings table in one call (all national teams),
not a single-team lookup. This is a better fit for KV caching than the
original per-team draft: cache the WHOLE table once, filter to a specific
team from the cached data — one upstream call serves every team, not one
call per team.

```javascript
// FIFA world rankings, cached aggressively (rankings update ~monthly in
// reality). Real consumer: dramaScoreLive's soccer upset-factor bonus
// (client-side, CC-CMD-2026-07-04-soccer-drama-scoring-fix.md).
// Key provisioning: env.FOOTBALLDATA_FIFA_KEY -- Jeff sets this directly
// as a Cloudflare Worker secret (`wrangler secret put FOOTBALLDATA_FIFA_KEY`)
// or via GitHub secret -> CF Worker secret through deploy.yml, mirroring
// the existing env.SPORTRADAR_UFL_KEY pattern. The raw key value is
// NEVER written into this file or any committed code -- only the env
// var name.
const FIFA_RANKINGS_KV_TTL_SECS = 7 * 24 * 60 * 60; // 7 days
const FIFA_RANKINGS_KV_KEY = 'field:fifa-rankings:men'; // whole-table cache

if (pathname.startsWith('/fifa-rankings/')) {
    const teamName = decodeURIComponent(pathname.slice('/fifa-rankings/'.length));
    if (!teamName) {
        return new Response(JSON.stringify({ ok: false, error: 'team name required' }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
        let table = env.FIELD_JOURNALISM ? await env.FIELD_JOURNALISM.get(FIFA_RANKINGS_KV_KEY, 'json') : null;
        let source = 'kv';
        if (!table) {
            const key = env.FOOTBALLDATA_FIFA_KEY;
            if (!key) {
                return new Response(JSON.stringify({ ok: false, error: 'FOOTBALLDATA_FIFA_KEY not configured' }),
                    { status: 503, headers: { 'X-RELAY-Error': 'fifa-rankings-no-key', ...CORS } });
            }
            // Verified real endpoint (footballdata.io/documentation/fifa-rankings/, 2026-07-04):
            const r = await fetch('https://footballdata.io/api/v1/fifa-rankings?type=men', {
                headers: { 'Authorization': `Bearer ${key}` },
            });
            if (!r.ok) {
                return new Response(JSON.stringify({ ok: false, error: `upstream ${r.status}` }),
                    { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const data = await r.json();
            table = data.data || [];
            source = 'live';
            if (env.FIELD_JOURNALISM && table.length) {
                await env.FIELD_JOURNALISM.put(FIFA_RANKINGS_KV_KEY, JSON.stringify(table), { expirationTtl: FIFA_RANKINGS_KV_TTL_SECS });
            }
        }
        const entry = table.find(t => (t.country_name || '').toLowerCase() === teamName.toLowerCase());
        if (!entry) {
            return new Response(JSON.stringify({ ok: false, error: 'team not found in rankings', source }),
                { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: true, rank: entry.rank, points: entry.points, team: entry.country_name, source }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

**CC: verify the raw `Authorization: Bearer` header format and the
`?type=men` query param are still exactly this on execution day** — this
was confirmed against footballdata.io's own docs page 2026-07-04, but
re-check before trusting it if this CC-CMD is executed much later.

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
- [ ] Endpoint added exactly as verified above (whole-table fetch, `type=men`, `footballdata.io` not `api.footballdata.io`), KV-first with 7-day TTL
- [ ] `node --check src/index.js` clean
- [ ] Deploy succeeds
- [ ] Confirm whether `FOOTBALLDATA_FIFA_KEY` has actually been set as a Cloudflare Worker secret yet (`wrangler secret list` or dashboard check) — do not assume it has been just because a key was generated on footballdata.io's side
- [ ] `GET /fifa-rankings/Argentina` tested against whatever the real current state is: if the secret isn't set yet, confirm the 503 graceful-failure path; if it IS set, confirm a real successful lookup returns `rank`/`points`/`team` for Argentina — report which case was actually true, don't assume either
- [ ] Outbox manifest written, explicitly stating the real observed state of both the secret provisioning and the live fetch result

**Deferred to chat/Jeff — cannot be completed without external action:**
- [ ] Confirm `FOOTBALLDATA_FIFA_KEY` is set as a Cloudflare Worker secret (a real API key was generated 2026-07-04, but chat could not confirm it's been wired into the Worker's environment — chat's sandbox cannot reach footballdata.io to test independently)
- [ ] Real successful ranking lookups for Argentina and Cape Verde once both the secret is confirmed set AND a live request succeeds

## COMPLIANCE
- Rule 47/ADR-002: returns raw rank/points numbers only, no derived "upset probability" or display-facing score — that computation happens client-side in dramaScoreLive as an internal signal, not here
- Rule 68: probe block first
- Rule 87: partially self-completing — the code-correctness portion is; live data verification depends on secret provisioning state, which must be checked, not assumed

## CONFIDENCE SCORING TABLE
+30  Endpoint added exactly as specified (verified real footballdata.io shape)
+30  Whole-table caching design confirmed correct — one upstream call serves all teams, not one call per team
+20  Graceful 503 behavior confirmed if key isn't wired in yet, OR real successful lookup confirmed if it is — whichever is actually true
+20  Deploy succeeds, `node --check` clean

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-fifa-rankings-relay.md. The real
footballdata.io endpoint shape is already verified in this doc (whole-
table fetch, `type=men`, base domain `footballdata.io`) — do not
re-derive it, but do confirm it's still accurate if much time has
passed. A real API key exists (generated 2026-07-04) but has NOT been
confirmed wired into this Worker as `FOOTBALLDATA_FIFA_KEY` — check
this first, don't assume either way. Implement exactly as specified.
Do not commit unless confidence ≥ 95. If score < 95 report verbatim and
stop — do not invent results.
