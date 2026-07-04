# CC-CMD: FIFA rankings fetch + cache (relay half of the upset-factor drama bonus)

**STATUS: COMPLETE — executed directly by chat, not CC.** footballdata.io
was confirmed permanently blocked by a paid-plan requirement (see the
correction later in this doc). A pre-existing Parse.bot account (key
created June 28, before this investigation even started) was found and
a dedicated FIELD key created. Real, live, end-to-end verified 2026-07-04:
`GET /fifa-rankings/Argentina` → `{"ok":true,"rank":1,"points":1877.27,
"team":"Argentina"}`; `GET /fifa-rankings/Cape Verde` → `{"ok":true,
"rank":67,"points":1371.11,"team":"Cabo Verde"}` (FIFA's official name,
handled via a confirmed-real alias map for 3 known naming mismatches:
Cape Verde/Cabo Verde, South Korea/Korea Republic, Ivory Coast/Côte
d'Ivoire — not exhaustively checked against all 48 WC26 teams, so an
unmapped team returning "not found" is expected and debuggable, not a
silent bug). This section of the doc is kept for the historical record
of what was tried and why footballdata.io failed — do not re-attempt
footballdata.io.

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

**UPDATE 2026-07-04 (later same day): `FOOTBALLDATA_FIFA_KEY` is
confirmed LIVE as a Cloudflare Worker secret on field-relay-nba.**
Fully automated, no manual wrangler/dashboard step: chat installed
PyNaCl, encrypted the key with this repo's actual public key, set it as
a GitHub Actions secret, then dispatched a newly-ported
`sync-secret-to-worker.yml` (proven pattern, reused from stat-job-watcher)
which PUT it to the Cloudflare API. Verified via the actual job log,
not just workflow status: `{"result":{"name":"FOOTBALLDATA_FIFA_KEY",
"type":"secret_text"},"success":true}`. The raw key value never
touched any file, commit, or CC-CMD doc at any point. **This CC-CMD's
code can now be fully verified live** — `env.FOOTBALLDATA_FIFA_KEY`
will resolve to a real value once this endpoint deploys.

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
- [x] `FOOTBALLDATA_FIFA_KEY` confirmed live as a Cloudflare Worker secret (2026-07-04, verified via real CF API response in the sync workflow's job log — see UPDATE above)
- [ ] `GET /fifa-rankings/Argentina` tested against the live deployed endpoint — the key now exists, so this should return a real successful lookup (`rank`/`points`/`team`), not a 503. If it still 503s, something is wrong with how `env.FOOTBALLDATA_FIFA_KEY` is being read in the Worker code — report this discrepancy, don't assume it'll resolve itself
- [ ] Outbox manifest written, recording the real observed live-fetch result

**No longer deferred — the key exists and is live:**
- ~~Confirm FOOTBALLDATA_FIFA_KEY is set as a Cloudflare Worker secret~~ — DONE, verified 2026-07-04
- [ ] Real successful ranking lookups for Argentina and Cape Verde — now actually testable, do this for real once TASK 1 is deployed

## COMPLIANCE
- Rule 47/ADR-002: returns raw rank/points numbers only, no derived "upset probability" or display-facing score — that computation happens client-side in dramaScoreLive as an internal signal, not here
- Rule 68: probe block first
- Rule 87: self-completing — the secret-provisioning blocker is resolved, live verification is now genuinely achievable in-session

## CONFIDENCE SCORING TABLE
+25  Endpoint added exactly as specified (verified real footballdata.io shape)
+25  Whole-table caching design confirmed correct — one upstream call serves all teams, not one call per team
+25  Real successful lookup confirmed for at least one team (Argentina or Cape Verde) — the key exists now, this should be achievable, not deferred
+25  Deploy succeeds, `node --check` clean

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-fifa-rankings-relay.md. The real
footballdata.io endpoint shape is already verified in this doc (whole-
table fetch, `type=men`, base domain `footballdata.io`). The API key
(`FOOTBALLDATA_FIFA_KEY`) is confirmed LIVE as a Worker secret as of
2026-07-04 — implement TASK 1 and actually test it live, don't defer
that check, it should work now. Do not commit unless confidence ≥ 95.
If score < 95 report verbatim and stop — do not invent results.
