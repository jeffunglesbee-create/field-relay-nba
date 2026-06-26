# CC-CMD: Add Kali AFL Stats relay route
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing
# Prereq: KALI_AFL_TOKEN already set (GitHub secret ✅ deploy.yml secrets+env ✅)

## CONTEXT

Kali AFL Stats (kaliaflstats.com) probed and verified 2026-06-26:
  /predictions — composite win probability with human-readable factors[]
  /tips        — 30-source tipping consensus (hconfidence 0-100 per source)
  /player-stats — per-match: kicks/handballs/disposals/goals/fantasy pts
  /player-stats-advanced — contested possessions/disposal efficiency/metres gained
  /standings   — live ladder with percentage + premiership points
  /leaderboards — top players by any stat for a season/round
  /head-to-head — H2H history (params: team_a= team_b=, slug format)

KALI_AFL_TOKEN already in deploy.yml secrets + env blocks. No wrangler.toml
changes needed — secret pushed to CF Worker on every deploy.

TWO CHANGES:
1. Remove /kali-probe dead code (L7005-7049 — nested inside /health if-block,
   unreachable, never served a request)
2. Add /kali/* relay route after /squiggle route (~L10001)
3. Update health string to include 'kali'

## PRE-BUILD PROBE

```bash
node --check src/index.js
# Confirm kali-probe dead code exists at the right location:
grep -n "kali-probe" src/index.js
# Expected: exactly 1 hit (L7006-ish, inside health block)
grep -n "pathname.startsWith.*squiggle" src/index.js
# Expected: 1 hit — insertion point for kali route
```

## CHANGE 1 — Remove /kali-probe dead code

The probe block is nested inside the /health if-block (unreachable).
Find this exact block and delete it:

```
        // Temporary Kali AFL Stats probe — remove after verification
        if (pathname === '/kali-probe' && request.method === 'GET') {
            const KALI_BASE = 'https://kaliaflstats.com/api/afl/v1';
            const KALI_KEY  = env.KALI_AFL_TOKEN;
            if (!KALI_KEY) return new Response(JSON.stringify({error:'KALI_AFL_TOKEN not set'}),
                {status:500, headers:{...CORS,'Content-Type':'application/json'}});
            const results = {};
            // Probe 1: fixture (public)
            try {
                const r1 = await fetch(`${KALI_BASE}/fixture`,
                    {headers:{'Authorization':`Bearer ${KALI_KEY}`,'Accept':'application/json'},signal:AbortSignal.timeout(5000)});
                results.fixture = {status: r1.status, data: await r1.json()};
            } catch(e) { results.fixture = {error: e.message}; }
            // Probe 2: matches round 16
            try {
                const r2 = await fetch(`${KALI_BASE}/matches?year=2026&round=16`,
                    {headers:{'Authorization':`Bearer ${KALI_KEY}`,'Accept':'application/json'},signal:AbortSignal.timeout(5000)});
                results.matches = {status: r2.status, data: await r2.json()};
            } catch(e) { results.matches = {error: e.message}; }
            // Probe 3: player-stats round 15 (latest completed)
            try {
                const r3 = await fetch(`${KALI_BASE}/player-stats?year=2026&round=15&limit=3`,
                    {headers:{'Authorization':`Bearer ${KALI_KEY}`,'Accept':'application/json'},signal:AbortSignal.timeout(5000)});
                results.playerStats = {status: r3.status, data: await r3.json()};
            } catch(e) { results.playerStats = {error: e.message}; }
            // Probe 4: advanced stats
            try {
                const r4 = await fetch(`${KALI_BASE}/player-stats-advanced?year=2026&round=15&limit=2`,
                    {headers:{'Authorization':`Bearer ${KALI_KEY}`,'Accept':'application/json'},signal:AbortSignal.timeout(5000)});
                results.advanced = {status: r4.status, data: await r4.json()};
            } catch(e) { results.advanced = {error: e.message}; }
            // Probe 5: head-to-head
            try {
                const r5 = await fetch(`${KALI_BASE}/head-to-head?teamA=carlton&teamB=collingwood`,
                    {headers:{'Authorization':`Bearer ${KALI_KEY}`,'Accept':'application/json'},signal:AbortSignal.timeout(5000)});
                results.h2h = {status: r5.status, data: await r5.json()};
            } catch(e) { results.h2h = {error: e.message}; }
            return new Response(JSON.stringify(results, null, 2),
                {headers:{...CORS,'Content-Type':'application/json'}});
        }
```

Replace with: (empty string — delete the entire block)

## CHANGE 2 — Add Kali TTL function + allowed paths (insert near squiggle constants)

Find the squiggle TTL function:
```
function squiggleTtl(search) {
```

Insert BEFORE it:

```js
// ── Kali AFL Stats — free, key-auth, 5,000 req/day ──────────────────────────
// Verified 2026-06-26: /predictions, /tips, /player-stats, /player-stats-advanced,
// /standings, /leaderboards, /head-to-head, /teams, /matches
// Endpoint h2h param: team_a= team_b= (slugs: "carlton", "collingwood" etc.)
// TTL strategy: predictions/tips/player-stats are post-round (1hr cache fine).
// standings/leaderboards update during round (30min cache).
const KALI_BASE    = 'https://kaliaflstats.com/api/afl/v1';
const KALI_ALLOWED = [
    '/predictions', '/tips', '/player-stats', '/player-stats-advanced',
    '/standings', '/leaderboards', '/head-to-head', '/teams', '/matches',
    '/players', '/fixture', '/venues',
];
function kaliAllowed(path) {
    return KALI_ALLOWED.some(p => path === p || path.startsWith(p + '?') || path.startsWith(p + '/'));
}
function kaliTtl(path) {
    if (path.startsWith('/predictions'))          return 3600;  // computed daily
    if (path.startsWith('/tips'))                 return 3600;  // synced daily
    if (path.startsWith('/player-stats'))         return 3600;  // post-round, stable
    if (path.startsWith('/head-to-head'))         return 7200;  // historical
    if (path.startsWith('/teams'))                return 86400; // static
    if (path.startsWith('/players'))              return 86400; // static
    if (path.startsWith('/venues'))               return 86400; // static
    return 1800; // standings, leaderboards, matches, fixture — 30min default
}

```

## CHANGE 3 — Add /kali/* route handler

Find:
```
        // /squiggle → api.squiggle.com.au (CORS bypass + shared edge cache)
```

Insert BEFORE it:

```js
        // /kali/* → kaliaflstats.com/api/afl/v1 (KALI_AFL_TOKEN injected server-side)
        // Free tier: 5,000 req/day, resets 00:00 UTC. CF edge cache keeps usage low.
        // Provides: predictions/factors, tips (30 models), player-stats, advanced stats,
        //           standings, leaderboards, head-to-head (team_a= team_b= slug params).
        if (pathname.startsWith('/kali/')) {
            const kaliKey = env.KALI_AFL_TOKEN;
            if (!kaliKey) return new Response(
                JSON.stringify({ error: 'KALI_AFL_TOKEN not configured' }),
                { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
            const cleanPath = pathname.replace(/^\/kali/, '');
            if (!kaliAllowed(cleanPath)) return new Response(
                'Kali path not allowed',
                { status: 403, headers: { ...CORS, 'X-RELAY-Error': 'kali-path-not-whitelisted' } }
            );
            const targetUrl = `${KALI_BASE}${cleanPath}${url.search || ''}`;
            return relayFetch(
                targetUrl,
                { 'Authorization': `Bearer ${kaliKey}`, 'Accept': 'application/json' },
                kaliTtl(cleanPath),
                'kali',
                ctx
            );
        }

```

## CHANGE 4 — Update health string

Find:
```
`RELAY OK — nba + nhl + fpl + fd + odds + apisports + squiggle + atp + bdl + espn-gambit
```

Replace with:
```
`RELAY OK — nba + nhl + fpl + fd + odds + apisports + squiggle + kali + atp + bdl + espn-gambit
```

(add `+ kali +` after `+ squiggle +`)

## DONE CONDITIONS

1. node --check src/index.js passes
2. grep -c "kali-probe" src/index.js → 0 (dead code removed)
3. After deploy:

```bash
# Verify route is live
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/kali/standings?year=2026&limit=3" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
data=d.get('data',[])
print(f'standings: {len(data)} teams')
if data: print(f'  top: {data[0][\"teamName\"]} {data[0][\"wins\"]}W-{data[0][\"losses\"]}L ({data[0][\"percentage\"]}%)')
"
# Expected: standings: 3 teams, top: Fremantle 13W-1L (144.42%)

curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/kali/predictions?year=2026&round=16&limit=1" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
data=d.get('data',[])
if data:
    p=data[0]
    print(f'{p[\"homeTeam\"]} vs {p[\"awayTeam\"]}')
    print(f'  home prob: {p[\"homeProbability\"]}%')
    print(f'  factors: {[f[\"label\"] for f in p.get(\"factors\",[])]}')
"
# Expected: predictions with homeProbability and factors[]

# Health string check
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/health" | grep -o "kali"
# Expected: kali

# Confirmed blocked path
curl -si "https://field-relay-nba.jeffunglesbee.workers.dev/kali/admin" \
  | head -5
# Expected: HTTP/2 403
```

4. Commit: "feat(kali): add Kali AFL Stats relay route /kali/* — predictions + tips + player stats"
