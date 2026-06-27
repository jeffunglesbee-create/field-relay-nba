# CC-CMD: NHL V2 Migration — API-Sports → api-web.nhle.com + Draft Whitelist
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing

## CONTEXT

/nhl/* relay route live since May 17 2026 (faab85a). NHL_BASE, NHL_HEADERS
(Referer/Origin nhl.com), NHL_ALLOWED_EXACT/PREFIXES all in place.
V2_LEAGUES nhl still routes to v1.hockey.api-sports.io — this CC-CMD fixes that.

api-web.nhle.com = same API nhl.com uses. No auth key. No Akamai fingerprint
issues. Off-season scoreboard returns historical gamesByDate (last ~9 days)
not 403 — off-season returns 0 games for today's date cleanly.

NHLE scoreboard shape confirmed 2026-06-26:
  d.gamesByDate[].date     → filter to today (YYYY-MM-DD)
  d.gamesByDate[].games[]  → game objects
  g.id                     → game ID (e.g. 2025030324) — used for gamecenter calls
  g.gameState              → "LIVE"|"CRIT"|"FINAL"|"OFF"|"FUT"|"PRE"
  g.awayTeam.abbrev        → "COL"
  g.awayTeam.name.default  → "Colorado Avalanche" (full)
  g.awayTeam.commonName.default → "Avalanche" (short)
  g.awayTeam.score         → integer | undefined (pre-game)
  g.venue.default          → "T-Mobile Arena"
  g.period                 → integer
  g.periodDescriptor.number     → integer
  g.periodDescriptor.periodType → "REG"|"OT"|"SO"
  g.clock.timeRemaining    → "14:32" | null (null for pre/final)
  g.startTimeUTC           → "2026-05-27T01:00:00Z"
  g.tvBroadcasts[].network → "ESPN"|"ABC"|"NBC"|"SN" etc.

NHLE boxscore shape confirmed 2026-06-26 (/v1/gamecenter/{id}/boxscore):
  d.playerByGameStats.homeTeam.forwards[]:
    name.default: "J. Eichel" (abbreviated — NHL CDN format)
    goals, assists, points, plusMinus, sog, toi
  d.playerByGameStats.homeTeam.goalies[]:
    name.default, starter, saveShotsAgainst ("23/25"), savePctg, toi

NHLE landing threeStars confirmed (/v1/gamecenter/{id}/landing):
  d.summary.threeStars[]:
    star: 1|2|3, name.default: "M. Stone", teamAbbrev: "VGK"
    goals, assists, points
    (goalies): saveShotsAgainst, goalsAgainstAverage, savePctg

Draft endpoints on same base URL, same headers (not currently whitelisted):
  /v1/draft/picks/now      → live picks as announced during draft
  /v1/draft-tracker/picks/now → draft tracker
  /v1/draft/rankings/now   → ✅ confirmed 200 — prospect rankings by category
  /v1/draft/picks/{year}/{round} → historical picks (prefix match)

FIVE CHANGES to src/index.js:
  1. adaptNhle() — scoreboard game → FieldGame
  2. V2_LEAGUES nhl — add nhleSource: true
  3. NHLE early-return branch — before APISPORTS_KEY
     includes NHL brief pipeline (threeStars from landing)
  4. Mark old API-Sports nhl branch as unreachable
  5. Add draft paths to NHL_ALLOWED_EXACT (+4 lines)

## PRE-BUILD PROBE

```bash
node --check src/index.js

# Confirm NHL_BASE and NHL_HEADERS at module scope
grep -n "NHL_BASE\|NHL_HEADERS\b\|NHL_ALLOWED_EXACT" src/index.js | head -5
# Expected: L268-ish NHL_BASE, L277 NHL_HEADERS, L283 NHL_ALLOWED_EXACT

# Confirm NHLE scoreboard via relay
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/nhl/v1/scoreboard/now" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('gamesByDate:', len(d.get('gamesByDate',[])), 'focused:', d.get('focusedDate'))"
# Expected: gamesByDate: 9, focused: 2026-06-02 (or similar off-season date)

# Confirm insertion anchor
grep -n "end wc26 ESPN early-return" src/index.js
# Expected: 1 hit
```

## CHANGE 1 — adaptNhle() function

Insert immediately BEFORE `function adaptApiNba(g)`:

```js
// ── adaptNhle ─────────────────────────────────────────────────────────────────
// Maps api-web.nhle.com/v1/scoreboard/now gamesByDate[].games[] entry
// → standard V2 FieldGame shape.
// Shape confirmed 2026-06-26 against live NHL scoreboard (COL vs VGK SCF).
// NOTE: g.clock is null for pre/final games — guard required.
// NOTE: g.awayTeam.name.default = full name ("Colorado Avalanche")
//       g.awayTeam.commonName.default = short name ("Avalanche")
// NOTE: g.id carries the NHLE game ID for gamecenter/boxscore/landing/PBP calls
function adaptNhle(g) {
    const gs    = g?.gameState || '';
    const state = (gs === 'LIVE' || gs === 'CRIT')    ? 'live'  :
                  (gs === 'FINAL' || gs === 'OFF')     ? 'final' : 'pre';

    const periodNum  = g?.periodDescriptor?.number ?? g?.period ?? 0;
    const periodType = g?.periodDescriptor?.periodType || 'REG';
    const periodLabel = state === 'final'
        ? (periodType === 'OT' ? 'F/OT' : periodType === 'SO' ? 'F/SO' : '')
        : state === 'live'
        ? (periodType !== 'REG' ? periodType : `P${periodNum}`)
        : '';

    return {
        id:           `nhl:${g.id}`,
        nhleGameId:   g.id,    // NHLE native game ID — for gamecenter/boxscore/landing/PBP
        sport:        'nhl',
        league:       'NHL',
        state,
        start:        g?.startTimeUTC || '',
        home: {
            name:  g?.homeTeam?.name?.default || g?.homeTeam?.commonName?.default || '',
            abbr:  g?.homeTeam?.abbrev  || '',
            score: g?.homeTeam?.score   ?? null,
        },
        away: {
            name:  g?.awayTeam?.name?.default || g?.awayTeam?.commonName?.default || '',
            abbr:  g?.awayTeam?.abbrev  || '',
            score: g?.awayTeam?.score   ?? null,
        },
        periodNum,
        periodLabel,
        clock:  g?.clock?.timeRemaining || '',
        venue:  g?.venue?.default || '',
    };
}

```

## CHANGE 2 — V2_LEAGUES: update nhl entry

Find:
```
    'nhl':          { sport: 'hockey',     leagueId: 57,  season: '2025'      }, // VERIFIED: hockey API requires integer season (2025 = 2025-26 season)
```

Replace with:
```
    // NHL — migrated June 26 2026: API-Sports → api-web.nhle.com (NHLE)
    // /nhl/* relay route live since May 17 2026. No auth key. Same API as nhl.com.
    // Off-season scoreboard returns historical gamesByDate (no 403).
    // nhleGameId field on game objects enables gamecenter/boxscore/landing/PBP calls.
    'nhl':          { sport: 'nhl', nhleSource: true, season: '20252026' },
```

## CHANGE 3 — NHLE early-return branch

Find the insertion anchor:
```
    // ── end wc26 ESPN early-return ────────────────────────────────────────────

    // ── NBA CDN early-return (migrated June 26 2026) ──────────────────────────
```

Insert BETWEEN those two lines:

```js
    // ── NHL NHLE early-return (migrated June 26 2026) ─────────────────────────
    // api-web.nhle.com/v1/scoreboard/now → filter to today's date → adaptNhle.
    // Off-season: focusedDate lags today → todayEntry is undefined → 0 games, no error.
    // Brief pipeline: threeStars from /v1/gamecenter/{id}/landing (NHL-curated performers).
    if (cfg.nhleSource) {
        try {
            const nhleResp = await fetch(
                `${NHL_BASE}/v1/scoreboard/now`,
                {
                    headers: NHL_HEADERS,
                    cf: { cacheTtl: 30, cacheEverything: true,
                          cacheKey: `${NHL_BASE}/v1/scoreboard/now` },
                }
            );
            if (!nhleResp.ok) {
                return new Response(
                    JSON.stringify({ sport, date, games: [], count: 0, source: 'nhle-error', ts: Date.now() }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } }
                );
            }
            const nhleData   = await nhleResp.json();
            const todayEntry = (nhleData.gamesByDate || []).find(e => e.date === date);
            const games      = (todayEntry?.games || []).map(adaptNhle);

            // ── NHL brief pipeline (NHLE landing/threeStars variant) ───────────
            // Uses NHL's own three-star selections — curated performers per game.
            // Fires only for final games. Avoids API-Sports player stats dependency.
            if (env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
                const nhlFinals = games.filter(g => g.state === 'final');
                if (nhlFinals.length > 0) {
                    const enqueueNHLBriefs = async () => {
                        for (const g of nhlFinals) {
                            const kvKey = `brief:game:${g.id}`;
                            const existing = await env.FIELD_JOURNALISM.get(kvKey).catch(() => null);
                            if (existing) continue;

                            const home      = g.home?.name || '';
                            const away      = g.away?.name || '';
                            const homeScore = g.home?.score ?? 0;
                            const awayScore = g.away?.score ?? 0;

                            // Fetch three stars from NHLE landing endpoint
                            let starsContext = '';
                            try {
                                const landingRes = await fetch(
                                    `${NHL_BASE}/v1/gamecenter/${g.nhleGameId}/landing`,
                                    { headers: NHL_HEADERS, cf: { cacheTtl: 300, cacheEverything: true } }
                                );
                                if (landingRes.ok) {
                                    const ld = await landingRes.json();
                                    const stars = ld.summary?.threeStars || [];
                                    const lines = stars.map(s => {
                                        const name = s.name?.default || '?';
                                        const team = s.teamAbbrev   || '';
                                        if (s.position === 'G') {
                                            const sv  = s.saveShotsAgainst || '';
                                            const pct = s.savePctg != null
                                                ? `${(s.savePctg * 100).toFixed(1)}%` : '';
                                            return `${name} (${team}): ${sv} sv ${pct}`.trim();
                                        }
                                        return `${name} (${team}): ${s.goals ?? 0}G ${s.assists ?? 0}A`;
                                    });
                                    if (lines.length) starsContext = '\n\nTHREE STARS:\n' + lines.join('\n');
                                }
                            } catch (_) {}

                            const prompt = [
                                FIELD_VOICE_REGISTER,
                                `Write a 2-3 sentence post-game brief for this NHL result.`,
                                `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through.`,
                                `Include: three-star performers, key moment or turning point, what this means for the series or standings.`,
                                `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
                                ``,
                                `RESULT: ${away} ${awayScore} at ${home} ${homeScore}`,
                                g.venue ? `Venue: ${g.venue}` : '',
                                starsContext,
                                ``,
                                `SPORT BOUNDARY: This is an NHL hockey game. Write ONLY NHL hockey content.`,
                                `Write the brief as a single paragraph. No headers, no bullet points.`,
                            ].filter(Boolean).join('\n');

                            try {
                                await env.JOURNALISM_QUEUE.send({
                                    type:        'game-brief',
                                    prompt,
                                    eventId:     g.id,
                                    max_tokens:  300,
                                    sport:       'nhl',
                                    home, away, homeScore, awayScore,
                                    enqueuedAt:  Date.now(),
                                });
                            } catch (e) {
                                console.error('[NHL game-brief enqueue NHLE]', e.message);
                            }
                        }
                    };
                    if (ctx?.waitUntil) ctx.waitUntil(enqueueNHLBriefs());
                    else await enqueueNHLBriefs();
                }
            }
            // ── end NHL brief pipeline NHLE ────────────────────────────────────

            return new Response(
                JSON.stringify({ sport, date, games, count: games.length, source: 'nhle', ts: Date.now() }),
                { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } }
            );
        } catch (e) {
            return new Response(
                JSON.stringify({ error: 'NHLE upstream error', sport, date }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
    }
    // ── end NHL NHLE early-return ──────────────────────────────────────────────

```

## CHANGE 4 — Mark old API-Sports hockey branch as unreachable

Find:
```
        } else if (cfg.sport === 'hockey')  adapt = items => items.map(adaptHockey);
```

Replace with:
```
        } else if (cfg.sport === 'hockey')  adapt = items => items.map(adaptHockey);  // UNREACHABLE after NHLE migration June 26 2026
```

## CHANGE 5 — Add draft paths to NHL_ALLOWED_EXACT

Find:
```
const NHL_ALLOWED_EXACT = [
    '/v1/scoreboard/now',
    '/v1/standings/now',
```

Replace with:
```
const NHL_ALLOWED_EXACT = [
    '/v1/scoreboard/now',
    '/v1/standings/now',
    '/v1/draft/picks/now',           // live draft picks — active during NHL draft
    '/v1/draft-tracker/picks/now',   // draft tracker — most recent pick
    '/v1/draft/rankings/now',        // prospect rankings by category
```

Also find NHL_ALLOWED_PREFIXES and add draft picks historical:

Find:
```
const NHL_ALLOWED_PREFIXES = [
    '/v1/schedule/',        // /v1/schedule/2026-05-20
    '/v1/standings/',       // /v1/standings/2026-05-20
    '/v1/gamecenter/',      // /v1/gamecenter/{id}/boxscore|landing|play-by-play|right-rail
    '/v1/score/',           // /v1/score/{date}
```

Replace with:
```
const NHL_ALLOWED_PREFIXES = [
    '/v1/schedule/',        // /v1/schedule/2026-05-20
    '/v1/standings/',       // /v1/standings/2026-05-20
    '/v1/gamecenter/',      // /v1/gamecenter/{id}/boxscore|landing|play-by-play|right-rail
    '/v1/score/',           // /v1/score/{date}
    '/v1/draft/picks/',     // /v1/draft/picks/{year}/{round}
    '/v1/draft/rankings/',  // /v1/draft/rankings/{year}/{category}
```

## DONE CONDITIONS

1. node --check src/index.js passes
2. grep -c "nhleSource" src/index.js → 2 (V2_LEAGUES + early-return check)
3. grep -c "draft" src/index.js → new hits in NHL_ALLOWED_EXACT
4. After deploy:

```bash
# Off-season: scoreboard has no today's games → 0 games, source: nhle
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=nhl" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('source:', d.get('source'))
print('games:', len(d.get('games',[])))
"
# Expected: source: nhle, games: 0

# Draft whitelist: rankings/now now accessible
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/nhl/v1/draft/rankings/now" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('draftYear:', d.get('draftYear'))
print('categories:', [c['name'] for c in d.get('categories',[])])
"
# Expected: draftYear: 2026, categories: [NA Skater, Intl Skater, NA Goalie, Intl Goalie]

# Regression: WNBA still on ESPN
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wnba" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('wnba:', d.get('source'))"
# Expected: espn-wc

# Draft picks/now (may be empty if draft not in progress — 200 OK with empty picks is fine)
curl -si "https://field-relay-nba.jeffunglesbee.workers.dev/nhl/v1/draft/picks/now" | head -3
# Expected: HTTP/2 200 (not 403)

5. Commit: "feat(nhl): migrate V2_LEAGUES NHL from API-Sports to NHLE + draft whitelist — adaptNhle + threeStars brief pipeline"
