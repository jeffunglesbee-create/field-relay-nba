# CC-CMD A: BSD Relay Integration
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Rule 87:** Self-completing.

## WHAT THIS ADDS

BSD Bzzoiro Sports Data integration. No existing BSD refs in relay.
BSD_API_TOKEN already stored in GH secrets (2026-06-25).

New relay routes (pure proxies, Rule 47):
- `/bsd/events/live`             — all live football matches
- `/bsd/events/:id/shotmap`      — per-shot xG with (x,y) coordinates
- `/bsd/events/:id/momentum`     — minute-by-minute pressure index −100→+100
- `/bsd/events/:id/incidents`    — goal build-up sequences
- `/bsd/events/:id/odds`         — 14 bookmakers + Polymarket consensus
- `/bsd/tennis/matches/live`     — ATP + WTA live matches (Sports Pack)
- `/bsd/tennis/matches/:id`      — match detail with set scores

BSD adds what ESPN Core API lacks: per-shot coordinates, momentum, build-ups, tennis.
The existing /soccer/xg route (ESPN Core) is NOT replaced — both coexist.

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba

# 1. Confirm BSD_API_TOKEN available in CI
gh secret list | grep BSD_API_TOKEN
# Expected: BSD_API_TOKEN listed

# 2. Confirm NO BSD refs yet
grep -r 'bzzoiro\|BSD_API\|bsd/' src/index.js | wc -l
# Expected: 0

# 3. Confirm wrangler.toml does NOT already have BSD_API_TOKEN
grep 'BSD' wrangler.toml
# Expected: no output

# 4. Get line count for insertion points
wc -l src/index.js
grep -n "\/\/ ── Relay health" src/index.js | head -1
# Expected: gives line number for route insertion point near health check
```

## TASK 1 — Add BSD_API_TOKEN to wrangler.toml

Append to wrangler.toml after the last `[[queues.consumers]]` block:

```toml
# ── BSD Bzzoiro Sports Data (June 25 2026) ──────────────────────────────────
# Football REST API (free) + Sports Pack (tennis/hockey $5/mo) + WebSocket ($3/mo)
# Token stored in GH secrets BSD_API_TOKEN → injected via wrangler deploy
# Docs: https://sports.bzzoiro.com/docs/football/
[vars]
BSD_BASE = "https://sports.bzzoiro.com"
```

Then add to the `[secrets]` deploy step in deploy.yml (append to env block):
```yaml
          BSD_API_TOKEN: ${{ secrets.BSD_API_TOKEN }}
```

## TASK 2 — Add BSD route handler to src/index.js

Find the insertion point: search for `pathname === '/health/sources'` and insert the
BSD handler block BEFORE it. Add this complete handler:

```javascript
// ── BSD Bzzoiro Sports Data routes ───────────────────────────────────────────
// Pure proxy — Rule 47. All editorial intelligence lives client-side.
// Auth: Authorization: Token ${env.BSD_API_TOKEN}
// Docs: https://sports.bzzoiro.com/docs/football/
if (pathname.startsWith('/bsd/')) {
  const BSD_BASE = 'https://sports.bzzoiro.com';
  const bsdToken = env.BSD_API_TOKEN;
  if (!bsdToken) {
    return new Response(JSON.stringify({ error: 'BSD_API_TOKEN not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
  }
  const bsdHeaders = {
    'Authorization': `Token ${bsdToken}`,
    'User-Agent': 'FIELD/1.0',
    'Accept': 'application/json',
  };

  // /bsd/events/live → BSD /api/v2/events/live/
  if (pathname === '/bsd/events/live') {
    const cache = caches.default;
    const cacheKey = new Request(`${BSD_BASE}/api/v2/events/live/`, req);
    const cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, { ...cached, headers: { ...Object.fromEntries(cached.headers), ...CORS } });
    const r = await fetch(`${BSD_BASE}/api/v2/events/live/`, { headers: bsdHeaders });
    const body = await r.text();
    const resp = new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=25', ...CORS } });
    if (r.ok) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }

  // /bsd/events/:id/shotmap → BSD /api/v2/events/:id/stats/
  const shotmapMatch = pathname.match(/^\/bsd\/events\/(\d+)\/shotmap$/);
  if (shotmapMatch) {
    const id = shotmapMatch[1];
    const r = await fetch(`${BSD_BASE}/api/v2/events/${id}/stats/`, { headers: bsdHeaders });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...CORS } });
  }

  // /bsd/events/:id/momentum → BSD /api/v2/events/:id/momentum/
  const momentumMatch = pathname.match(/^\/bsd\/events\/(\d+)\/momentum$/);
  if (momentumMatch) {
    const id = momentumMatch[1];
    const r = await fetch(`${BSD_BASE}/api/v2/events/${id}/momentum/`, { headers: bsdHeaders });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...CORS } });
  }

  // /bsd/events/:id/incidents → BSD /api/v2/events/:id/incidents/
  const incidentsMatch = pathname.match(/^\/bsd\/events\/(\d+)\/incidents$/);
  if (incidentsMatch) {
    const id = incidentsMatch[1];
    const r = await fetch(`${BSD_BASE}/api/v2/events/${id}/incidents/`, { headers: bsdHeaders });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...CORS } });
  }

  // /bsd/events/:id/odds → BSD /api/v2/events/:id/odds/comparison/
  const oddsMatch = pathname.match(/^\/bsd\/events\/(\d+)\/odds$/);
  if (oddsMatch) {
    const id = oddsMatch[1];
    const r = await fetch(`${BSD_BASE}/api/v2/events/${id}/odds/comparison/`, { headers: bsdHeaders });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...CORS } });
  }

  // /bsd/tennis/matches/live → BSD tennis /api/v2/matches/live/ (Sports Pack)
  if (pathname === '/bsd/tennis/matches/live') {
    const cache = caches.default;
    const cacheKey = new Request(`${BSD_BASE}/tennis/api/v2/matches/live/`, req);
    const cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, { ...cached, headers: { ...Object.fromEntries(cached.headers), ...CORS } });
    const r = await fetch(`${BSD_BASE}/tennis/api/v2/matches/live/`, { headers: bsdHeaders });
    const body = await r.text();
    const resp = new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=25', ...CORS } });
    if (r.ok) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }

  // /bsd/tennis/matches/:id → BSD tennis match detail
  const tennisMatchMatch = pathname.match(/^\/bsd\/tennis\/matches\/(\d+)$/);
  if (tennisMatchMatch) {
    const id = tennisMatchMatch[1];
    const r = await fetch(`${BSD_BASE}/tennis/api/v2/matches/${id}/`, { headers: bsdHeaders });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...CORS } });
  }

  // Unknown /bsd/* path
  return new Response(JSON.stringify({ error: 'Unknown BSD route', path: pathname }),
    { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } });
}
```

## TASK 3 — Wire deploy.yml to inject BSD_API_TOKEN

Find `wrangler deploy` step in `.github/workflows/deploy.yml` and add to its env block:
```yaml
          BSD_API_TOKEN: ${{ secrets.BSD_API_TOKEN }}
```

## TASK 4 — Smoke assertions (src/index.js search strings)

Add after the last smoke assertion in the relay's smoke block:

```javascript
// A_BSD_1: BSD route handler present
assert('/bsd/ route handler', src.includes("pathname.startsWith('/bsd/')"));
// A_BSD_2: BSD auth header injected correctly
assert('BSD auth header', src.includes('`Token ${bsdToken}`') || src.includes("'Token ' + bsdToken"));
// A_BSD_3: shotmap route present
assert('BSD shotmap route', src.includes('/bsd/events/:id/shotmap') || src.includes("'/bsd/events/'") || src.includes('/shotmap$'));
// A_BSD_4: tennis route present
assert('BSD tennis route', src.includes('/bsd/tennis/matches/live'));
// A_BSD_5: BSD_API_TOKEN check present
assert('BSD token guard', src.includes('BSD_API_TOKEN not configured'));
```

## DONE CONDITIONS

```bash
# 1. Relay smoke passes
node smoke.js 2>&1 | tail -3
# Expected: N passed, 0 failed

# 2. BSD routes present
grep -c 'pathname.startsWith.*bsd' src/index.js
# Expected: ≥ 1

# 3. All 7 BSD sub-routes defined
grep -c '/bsd/' src/index.js
# Expected: ≥ 7

# 4. BSD_API_TOKEN referenced
grep -c 'BSD_API_TOKEN' src/index.js wrangler.toml .github/workflows/deploy.yml
# Expected: ≥ 3 total

# 5. Live probe after deploy (replace with real WC game ID)
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live | jq '.count'
# Expected: integer ≥ 0

# 6. diff check
git diff --stat
# Expected: src/index.js wrangler.toml .github/workflows/deploy.yml only
```

## COMMIT

```bash
git add src/index.js wrangler.toml .github/workflows/deploy.yml
git commit -m "feat(bsd): add BSD relay routes — shotmap, momentum, incidents, odds, tennis"
git push origin main
```
