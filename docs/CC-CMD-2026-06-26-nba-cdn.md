# CC-CMD: NBA V2 Migration — API-Sports → NBA CDN
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing

## CONTEXT

field-relay-nba was built in May 2026 specifically to proxy cdn.nba.com.
NBA CDN is the foundation of every relay in FIELD. The V2_LEAGUES migration
to v2.nba.api-sports.io (May 30) was a detour during the ESPN pivot sprint.
This CC-CMD restores NBA CDN as the V2 scores source.

NBA CDN confirmed working 2026-05-29 against live OKC@SAS G6.
Off-season 403 from /nba/* is expected — CDN has no scoreboard when no games.
Treat 403 as 0-game response, not an error.

NBA_HEADERS already correct (Referer/Origin/User-Agent) — swar/nba_api PR #671
confirmed this exact fix; relay already had it. No header changes needed.

IMPORTANT — adaptApiNba handles API-Sports v2 shape, NOT CDN shape:
  API-Sports: g.status.long | g.scores.home.linescore | g.teams.home.code
  CDN:        g.gameStatus  | g.homeTeam.periods.period1-4 | g.homeTeam.teamTricode
New adaptNbaCDN() required.

CDN scoreboard shape (confirmed 2026-05-29 + MCP handler):
  d.scoreboard.games[] — array of game objects
  g.gameId             — "0042500316" (10-digit NBA native game ID)
  g.gameStatus         — 1=scheduled, 2=in-progress, 3=final
  g.gameStatusText     — "7:30 pm ET" | "Q2 05:23" | "Final"
  g.period             — quarter number (1-4, 5=OT)
  g.gameClock          — "PT05M23.00S" (ISO duration) or "" for pre/final
  g.gameTimeUTC        — "2026-10-22T23:30:00Z"
  g.homeTeam / g.awayTeam:
    .teamTricode        — "SAS", "OKC"
    .teamCity           — "San Antonio"
    .teamName           — "Spurs"
    .score              — integer
    .periods.period1-4  — per-quarter scores
  g.arenaName          — venue string (may be absent on scoreboard; use || '')

CDN boxscore shape (for brief pipeline):
  d.game.homeTeam.players[].name              — "Devin Vassell" (First Last, no reversal)
  d.game.homeTeam.players[].statistics.points / reboundsTotal / assists
  d.game.homeTeam.teamCity / teamName / teamTricode

FIVE CHANGES to src/index.js:
  1. adaptNbaCDN() — new function, CDN game → FieldGame
  2. V2_LEAGUES 'nba' — add nbaSource: 'cdn'
  3. NBA CDN early-return branch — before APISPORTS_KEY, after wc26 early-return
     includes full brief pipeline (CDN boxscore variant)
  4. Update stale cfg.sport === 'nba' API-Sports branch comment (now unreachable)
  5. Update stale NBA brief pipeline block comment (now unreachable)

## PRE-BUILD PROBE

```bash
node --check src/index.js

# Confirm NBA_CDN_BASE and NBA_HEADERS are at module scope
grep -n "NBA_CDN_BASE\|NBA_HEADERS\b\|NBA_CACHE_TTL\b" src/index.js | head -5
# Expected: L149 const NBA_CDN_BASE, L151 const NBA_HEADERS, L150 const NBA_CACHE_TTL

# Confirm adaptApiNba is distinct from CDN (API-Sports shape)
grep -n "g\.status\.long\|g\.teams\.home\|g\.scores\.home" src/index.js | head -5

# Confirm insertion anchor exists
grep -n "end wc26 ESPN early-return" src/index.js
# Expected: 1 hit
```

## CHANGE 1 — adaptNbaCDN() function

Insert immediately BEFORE the `function adaptApiNba(g)` line:

```js
// ── adaptNbaCDN ───────────────────────────────────────────────────────────────
// Maps cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json
// game object → standard V2 FieldGame shape.
// CDN shape confirmed 2026-05-29 (live OKC@SAS G6) + MCP get_live_scores handler.
// NOTE: CDN teamCity+teamName = "San Antonio"+"Spurs" → home.name = "San Antonio Spurs"
// NOTE: CDN player names are "First Last" — no reversal needed (unlike API-Sports)
// NOTE: g.nbaGameId carries the 10-digit native game ID for boxscore/PBP lookups
function adaptNbaCDN(g) {
    // gameStatus: 1=scheduled, 2=in-progress, 3=final
    const status = g?.gameStatus;
    const state  = status === 3 ? 'final' : status === 2 ? 'live' : 'pre';

    const periodNum = g?.period || 0;
    const periodLabel = state === 'final' ? '' :
        (periodNum >= 1 && periodNum <= 4) ? `Q${periodNum}` :
        (periodNum > 4) ? `OT${periodNum - 4}` : '';

    // gameClock: "PT05M23.00S" → "05:23"; "" or missing → ""
    const rawClock = g?.gameClock || '';
    const cm = rawClock.match(/PT(\d+)M([\d.]+)S/);
    const clock = cm ? `${cm[1]}:${String(Math.floor(parseFloat(cm[2]))).padStart(2,'0')}` : '';

    // Per-quarter linescores from homeTeam/awayTeam.periods object
    const ls = (periods) => {
        if (!periods || typeof periods !== 'object') return [];
        return ['period1','period2','period3','period4']
            .map(k => parseInt(periods[k]) || 0)
            .filter((v, i, a) => a.slice(0, i+1).some(x => x > 0) || v > 0)
            .slice(0, periodNum || 4);
    };

    return {
        id:         `nba:${g.gameId}`,
        nbaGameId:  g.gameId,   // 10-digit CDN game ID — used for boxscore/PBP relay calls
        sport:      'nba',
        league:     'NBA',
        state,
        start:      g?.gameTimeUTC || '',
        home: {
            name:  `${g?.homeTeam?.teamCity || ''} ${g?.homeTeam?.teamName || ''}`.trim(),
            abbr:  g?.homeTeam?.teamTricode || '',
            score: g?.homeTeam?.score ?? null,
        },
        away: {
            name:  `${g?.awayTeam?.teamCity || ''} ${g?.awayTeam?.teamName || ''}`.trim(),
            abbr:  g?.awayTeam?.teamTricode || '',
            score: g?.awayTeam?.score ?? null,
        },
        periodNum,
        periodLabel,
        clock,
        venue:      g?.arenaName || '',
        linescores: {
            home: ls(g?.homeTeam?.periods),
            away: ls(g?.awayTeam?.periods),
        },
    };
}

```

## CHANGE 2 — V2_LEAGUES: update nba entry

Find:
```
    'nba':          { sport: 'nba',        leagueId: null, season: '2025-2026' }, // routes to v2.nba.api-sports.io
```

Replace with:
```
    // NBA — migrated June 26 2026: API-Sports v2 → NBA CDN (cdn.nba.com)
    // NBA CDN is the original source field-relay-nba was built for (May 2026).
    // Off-season 403 from CDN is expected — scoreboard absent when no games.
    // nbaGameId field on game objects enables boxscore/PBP relay calls.
    'nba':          { sport: 'nba', nbaSource: 'cdn', season: '2025-2026' },
```

## CHANGE 3 — NBA CDN early-return branch

Find:
```
    // ── end wc26 ESPN early-return ────────────────────────────────────────────

    const key = env.APISPORTS_KEY;
```

Replace with:
```
    // ── end wc26 ESPN early-return ────────────────────────────────────────────

    // ── NBA CDN early-return (migrated June 26 2026) ──────────────────────────
    // CDN returns 403 in off-season (no scoreboard) — treat as 0 games, not error.
    // Brief pipeline runs here (CDN boxscore variant) before response is returned.
    if (cfg.nbaSource === 'cdn') {
        try {
            const cdnResp = await fetch(
                `${NBA_CDN_BASE}/liveData/scoreboard/todaysScoreboard_00.json`,
                {
                    headers: NBA_HEADERS,
                    cf: { cacheTtl: NBA_CACHE_TTL, cacheEverything: true,
                          cacheKey: `${NBA_CDN_BASE}/liveData/scoreboard/todaysScoreboard_00.json:${date}` },
                }
            );
            // Off-season 403 / no games → return empty slate, not 502
            if (!cdnResp.ok) {
                return new Response(
                    JSON.stringify({ sport, date, games: [], count: 0, source: 'nba-cdn-empty', ts: Date.now() }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }
                );
            }
            const cdnData = await cdnResp.json();
            const games   = (cdnData.scoreboard?.games || []).map(adaptNbaCDN);

            // ── NBA brief pipeline (CDN boxscore variant) ─────────────────────
            // Player stats from /nba/liveData/boxscore/boxscore_{nbaGameId}.json
            // CDN player names are "First Last" — no reversal needed.
            if (env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
                const nbaFinals = games.filter(g => g.state === 'final');
                if (nbaFinals.length > 0) {
                    const enqueueNBABriefs = async () => {
                        for (const g of nbaFinals) {
                            const kvKey = `brief:game:${g.id}`;
                            const existing = await env.FIELD_JOURNALISM.get(kvKey).catch(() => null);
                            if (existing) continue;

                            const home      = g.home?.name || '';
                            const away      = g.away?.name || '';
                            const homeScore = g.home?.score ?? 0;
                            const awayScore = g.away?.score ?? 0;

                            // Fetch CDN boxscore for player stats
                            let statsContext = '';
                            try {
                                const bsRes = await fetch(
                                    `${NBA_CDN_BASE}/liveData/boxscore/boxscore_${g.nbaGameId}.json`,
                                    { headers: NBA_HEADERS, cf: { cacheTtl: 300, cacheEverything: true } }
                                );
                                if (bsRes.ok) {
                                    const bs = await bsRes.json();
                                    const formatTeam = (team) => {
                                        if (!team?.players?.length) return '';
                                        const sorted = [...team.players]
                                            .sort((a, b) => (b.statistics?.points ?? 0) - (a.statistics?.points ?? 0));
                                        const tName = `${team.teamCity || ''} ${team.teamName || ''}`.trim();
                                        const lines = sorted.slice(0, 3).map(p => {
                                            // CDN: p.name = "Devin Vassell" (no reversal needed)
                                            const pts = p.statistics?.points        ?? 0;
                                            const reb = p.statistics?.reboundsTotal ?? 0;
                                            const ast = p.statistics?.assists       ?? 0;
                                            return `${p.name || '?'}: ${pts}pts/${reb}reb/${ast}ast`;
                                        }).join(', ');
                                        return `${tName}: ${lines}`;
                                    };
                                    const gameData = bs.game;
                                    const lines = [formatTeam(gameData?.homeTeam), formatTeam(gameData?.awayTeam)].filter(Boolean);
                                    if (lines.length) statsContext = '\n\nKEY PERFORMERS:\n' + lines.join('\n');
                                }
                            } catch (_) {}

                            const prompt = [
                                FIELD_VOICE_REGISTER,
                                `Write a 2-3 sentence post-game brief for this NBA result.`,
                                `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.`,
                                `Include: key performers with stats, decisive run or moment, what this means for the standings or series.`,
                                `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
                                ``,
                                `RESULT: ${away} ${awayScore} at ${home} ${homeScore}`,
                                g.venue ? `Venue: ${g.venue}` : '',
                                statsContext,
                                ``,
                                `SPORT BOUNDARY: This is an NBA basketball game. Write ONLY NBA basketball content.`,
                                `Write the brief as a single paragraph. No headers, no bullet points.`,
                            ].filter(Boolean).join('\n');

                            try {
                                await env.JOURNALISM_QUEUE.send({
                                    type:        'game-brief',
                                    prompt,
                                    eventId:     g.id,
                                    max_tokens:  300,
                                    sport:       'nba',
                                    home, away, homeScore, awayScore,
                                    enqueuedAt:  Date.now(),
                                });
                            } catch (e) {
                                console.error('[NBA game-brief enqueue CDN]', e.message);
                            }
                        }
                    };
                    if (ctx?.waitUntil) ctx.waitUntil(enqueueNBABriefs());
                    else await enqueueNBABriefs();
                }
            }
            // ── end NBA brief pipeline CDN ─────────────────────────────────────

            return new Response(
                JSON.stringify({ sport, date, games, count: games.length, source: 'nba-cdn', ts: Date.now() }),
                { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } }
            );
        } catch (e) {
            return new Response(
                JSON.stringify({ error: 'NBA CDN upstream error', sport, date }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
    }
    // ── end NBA CDN early-return ───────────────────────────────────────────────

    const key = env.APISPORTS_KEY;
```

## CHANGE 4 — Mark old API-Sports NBA branch as unreachable

Find:
```
    if (cfg.sport === 'nba') {
        // API-NBA: dedicated Pro plan at v2.nba.api-sports.io — no league/season params, date only.
        // Separate quota from API-BASKETBALL (WNBA uses basketball + league=13).
        // Response shape differs from API-BASKETBALL — use adaptApiNba (verified 2026-05-31).
        targetUrl = `https://${host}/games?date=${date}`;
        adapt = items => items.map(adaptApiNba);
```

Replace with:
```
    if (cfg.sport === 'nba') {
        // UNREACHABLE after June 26 2026 CDN migration — nbaSource:'cdn' early-returns above.
        // Kept as dead code in case cfg.nbaSource is unset (failsafe only).
        // Original: v2.nba.api-sports.io dedicated Pro plan, date-only query.
        targetUrl = `https://${host}/games?date=${date}`;
        adapt = items => items.map(adaptApiNba);
```

## CHANGE 5 — Mark old NBA brief pipeline block as unreachable

Find:
```
        // ── NBA brief auto-generation ─────────────────────────────────────────
        // When NBA games go final, enqueue a post-game brief to JOURNALISM_QUEUE.
        // KV dedup: skip if brief already exists. Player stats fetched from
        // api-sports /games/statistics/players for richer context.
        // Mirrors WC brief pipeline: queue consumer → Haiku → cliché check → KV.
        if (sport === 'nba' && env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
```

Replace with:
```
        // ── NBA brief auto-generation ─────────────────────────────────────────
        // UNREACHABLE after June 26 2026: NBA CDN early-return fires before this point.
        // NBA brief pipeline (CDN boxscore variant) now lives in the CDN early-return block.
        // This block retained as dead code in case nbaSource:'cdn' is ever removed.
        if (sport === 'nba' && env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
```

## DONE CONDITIONS

1. node --check src/index.js passes
2. grep -c "nbaSource.*cdn" src/index.js → 2 (V2_LEAGUES + early-return check)
3. After deploy:

```bash
# Off-season: CDN returns 403 → relay returns 0 games with source nba-cdn-empty
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=nba" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('source:', d.get('source'))
print('games:', len(d.get('games',[])))
"
# Expected: source: nba-cdn-empty (or nba-cdn), games: 0

# Health string contains nba (no change required — wasn't in health string before)

# Regression: WNBA still on ESPN
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wnba" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('wnba:', d.get('source'))"

# Regression: NHL still on API-Sports
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=nhl" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('nhl:', d.get('source'))"

4. Commit: "feat(nba): migrate V2_LEAGUES NBA from API-Sports to NBA CDN — adaptNbaCDN + brief pipeline CDN variant"
