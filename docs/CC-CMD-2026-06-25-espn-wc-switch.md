# Claude Code Command — ESPN WC Switch

`git pull && cat CLAUDE.md`

Write all findings to `outbox/cc-espn-wc-switch-2026-06-25.md`.

---

## CONTEXT

API-Sports Football Pro (league=1, season=2026) provides WC live scores for
the `wc26` sport slot. The June 29 renewal deadline makes this an active cost
decision. ESPN provides equivalent WC coverage for free via the same
`fifa.world` scoreboard slug already used by the journalism cron.

This CC-CMD switches `wc26` in `handleV2Games` from API-Sports to ESPN.
All downstream consumers (writeWCResult → D1, BracketDO push, BSD enrichment,
WP computation, GameDO crunch signals) are preserved.

Two specific gaps are also closed:
- **Gap A** — `eventsContext` in WC post-match briefs: replace API-Sports
  `/fixtures/events` call with ESPN `/summary` keyEvents.
- **Gap B** — `computeLiveWP` elapsed=0: populate `situation.elapsed` from
  ESPN `status.clock` (seconds, already present in scoreboard for live games).

---

## PRE-BUILD PROBES

```bash
# 1. Confirm wc26 config line
grep -n 'wc26' src/index.js | grep leagueId

# 2. Confirm adaptFootball location
grep -n 'function adaptFootball' src/index.js

# 3. Confirm APISPORTS_KEY gate location (insertion point for ESPN early-return)
grep -n 'APISPORTS_KEY not configured' src/index.js | head -3

# 4. Confirm eventsContext block location in writeWCResult
grep -n 'fixtures/events' src/index.js

# 5. Live probe — ESPN WC scoreboard returns status.clock for live games
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260626" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for ev in d.get('events',[]):
    comp=ev.get('competitions',[{}])[0]
    st=comp.get('status',{})
    teams=comp.get('competitors',[])
    h=next((t for t in teams if t.get('homeAway')=='home'),{})
    a=next((t for t in teams if t.get('homeAway')=='away'),{})
    print(f'{h.get(\"team\",{}).get(\"displayName\")} vs {a.get(\"team\",{}).get(\"displayName\")}')
    print(f'  clock={st.get(\"clock\")} displayClock={st.get(\"displayClock\")} state={st.get(\"type\",{}).get(\"state\")}')
"

# 6. Confirm ESPN summary keyEvents for a known WC game (use any completed game id)
# curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760473" \
#   | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('keyEvents',[])), 'keyEvents')"
```

---

## TASK 1 — V2_GAMES config: add espnLeague flag to wc26

In `src/index.js`, find the line (approx L1014):
```js
'wc26':         { sport: 'football',   leagueId: 1,   season: '2026'      },
```

Replace with:
```js
'wc26':         { sport: 'football',   leagueId: 1,   season: '2026',
                  espnLeague: 'fifa.world' },
```

The `espnLeague` flag is the gate for the ESPN early-return added in TASK 3.

---

## TASK 2 — Add `adaptESPNWCSoccer(ev)` function

Place immediately after `function adaptFootball(item, sportKey, statsData)` ends
(the closing `}` before `// ── WC D1 helpers ────────────`).

```js
// ── ESPN WC scoreboard adapter (June 2026) ────────────────────────────────
// Replaces adaptFootball() for the wc26 sport slot. Produces the same game
// object shape so all downstream consumers (writeWCResult, BSD enrichment,
// computeLiveWP, GameDO, BracketDO) work without modification.
//
// Key fields vs adaptFootball():
//   id            — 'espn:{ev.id}' (was 'football:{fix.id}')
//   espnEventId   — String(ev.id), used by writeWCResult eventsContext (Gap A)
//   situation     — populated for live games from status.clock (Gap B)
//   situation.homeSOT / awaySOT — null (ESPN scoreboard doesn't expose SOT);
//                   computeLiveWP falls back to pregameLambda-only path
//
// NFD normalization in extractWCGroup handles accented names (Curaçao, Türkiye).
// round is empty string — extractWCGroup uses _WC_TEAM_GROUP name fallback.
function adaptESPNWCSoccer(ev) {
    const comp       = ev.competitions?.[0] || {};
    const teams      = comp.competitors   || [];
    const home       = teams.find(t => t.homeAway === 'home') || {};
    const away       = teams.find(t => t.homeAway === 'away') || {};
    const statusType = comp.status?.type  || {};
    const completed  = statusType.completed === true;
    const statusState = statusType.state  || '';
    const statusName  = statusType.name   || '';

    const state = completed   ? 'final'
        : statusState === 'in' ? 'live'
        : 'pre';

    // Gap B: elapsed time from ESPN status.clock (seconds, present for all states)
    const clockSec    = comp.status?.clock    || 0;
    const elapsed     = Math.floor(clockSec / 60);
    const displayClock = comp.status?.displayClock || '';
    const isStoppage  = displayClock.includes('+');
    const isHalftime  = statusName === 'STATUS_HALFTIME';
    const isShootout  = statusName.includes('PENALTY') || statusName === 'STATUS_SHOOTOUT';

    const situation = (state === 'live') ? {
        elapsed,
        isStoppage,
        isHalftime,
        isShootout,
        manAdvantage: null,  // not available from ESPN scoreboard
        homeSOT:      0,     // not available from ESPN scoreboard
        awaySOT:      0,
        hasStats:     false,
    } : null;

    const homeScore = home.score != null ? Number(home.score) : null;
    const awayScore = away.score != null ? Number(away.score) : null;

    return {
        id:          `espn:${ev.id}`,
        espnEventId: String(ev.id),   // for writeWCResult eventsContext (Gap A)
        sport:       'wc26',
        league:      'FIFA World Cup',
        state,
        start:       comp.date || '',
        home:        { name: home.team?.displayName || '', abbr: home.team?.abbreviation || '', score: homeScore },
        away:        { name: away.team?.displayName || '', abbr: away.team?.abbreviation || '', score: awayScore },
        clock:       displayClock,
        venue:       typeof comp.venue === 'object' ? (comp.venue?.fullName || '') : '',
        round:       '',   // no round string from ESPN; extractWCGroup uses _WC_TEAM_GROUP fallback
        situation,
    };
}
```

---

## TASK 3 — Add ESPN early-return in handleV2Games

In `src/index.js`, find the APISPORTS_KEY gate (approx L2878):
```js
    const key = env.APISPORTS_KEY;
    if (!key)
        return new Response(JSON.stringify({ error: 'APISPORTS_KEY not configured' }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
```

Insert the following block BEFORE `const key = env.APISPORTS_KEY;`:

```js
    // ── wc26 ESPN early-return ────────────────────────────────────────────────
    // For sports with espnLeague configured, bypass API-Sports entirely.
    // Currently: wc26 only. Identical downstream behavior: BSD enrichment,
    // WP computation, writeWCResult D1 write, and GameDO crunch signals all run.
    if (cfg.espnLeague) {
        const espnDate = date.replace(/-/g, '');
        const espnUrl  = `https://site.api.espn.com/apis/site/v2/sports/soccer/${cfg.espnLeague}/scoreboard?dates=${espnDate}`;
        let espnGames  = [];
        try {
            const espnResp = await fetch(espnUrl, {
                cf: { cacheTtl: 15, cacheEverything: true, cacheKey: espnUrl },
            });
            if (!espnResp.ok) {
                return new Response(
                    JSON.stringify({ error: `ESPN upstream ${espnResp.status}`, sport, date }),
                    { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
            const espnData = await espnResp.json();
            espnGames = (espnData.events || []).map(ev => adaptESPNWCSoccer(ev));
        } catch (e) {
            return new Response(
                JSON.stringify({ error: e.message, sport, date }),
                { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
        const games = espnGames;

        // BSD event ID enrichment — identical to football branch.
        // Matches by team name (teamNameMatch) — works with ESPN display names.
        if (env.BSD_API_TOKEN) {
            try {
                const _bsdR = await fetch('https://sports.bzzoiro.com/api/v2/events/live/', {
                    headers: {
                        'Authorization': `Token ${env.BSD_API_TOKEN}`,
                        'User-Agent': 'FIELD/1.0',
                        'Accept': 'application/json',
                    },
                    signal: AbortSignal.timeout(3000),
                });
                if (_bsdR.ok) {
                    const _bsdLive   = await _bsdR.json();
                    const _bsdEvents = Array.isArray(_bsdLive.events) ? _bsdLive.events : [];
                    for (const _g of games) {
                        const _bsdMatch = _bsdEvents.find(_e => {
                            const _bh = String(_e.home_team?.name ?? _e.home_team ?? '');
                            const _ba = String(_e.away_team?.name ?? _e.away_team ?? '');
                            return (teamNameMatch(_bh, _g.home.name) && teamNameMatch(_ba, _g.away.name))
                                || (teamNameMatch(_bh, _g.away.name) && teamNameMatch(_ba, _g.home.name));
                        });
                        if (_bsdMatch) _g.bsdEventId = String(_bsdMatch.id);
                    }
                }
            } catch (_) {}
        }

        // Pre-game λ from Odds API (for computeLiveWP blending)
        const wcLambdas = await getWCPregameLambdas(env);

        // WP computation + crunch + GameDO — identical to football branch.
        for (const g of games) {
            if (g.state !== 'live' || !g.situation) continue;
            const { situation: sit } = g;
            const hGoals = g.home.score ?? 0;
            const aGoals = g.away.score ?? 0;

            let pregameLh = null, pregameLa = null;
            if (wcLambdas) {
                const directKey = `${g.home.name}|${g.away.name}`;
                if (wcLambdas.has(directKey)) {
                    const lams = wcLambdas.get(directKey);
                    pregameLh = lams.lh; pregameLa = lams.la;
                } else {
                    for (const [k, lams] of wcLambdas) {
                        const [oddsHome, oddsAway] = k.split('|');
                        if (teamNameMatch(oddsHome, g.home.name) && teamNameMatch(oddsAway, g.away.name)) {
                            pregameLh = lams.lh; pregameLa = lams.la; break;
                        }
                        if (teamNameMatch(oddsHome, g.away.name) && teamNameMatch(oddsAway, g.home.name)) {
                            pregameLh = lams.la; pregameLa = lams.lh; break;
                        }
                    }
                }
            }

            const wp = computeLiveWP({
                homeGoals:    hGoals,
                awayGoals:    aGoals,
                homeSOT:      sit.homeSOT      || 0,
                awaySOT:      sit.awaySOT      || 0,
                elapsedMin:   sit.elapsed      || 0,
                isStoppage:   sit.isStoppage   || false,
                manAdvantage: sit.manAdvantage || null,
                isShootout:   sit.isShootout   || false,
                pregameLh,
                pregameLa,
            });
            g.winProb = wp;

            // Advancement probability (wc26 group stage)
            if (env.WC2026_DB) {
                const gLetter = extractWCGroup(g.round, g.home?.name, g.away?.name);
                if (gLetter) {
                    try {
                        const [standingsRes, thirdRes] = await Promise.allSettled([
                            env.WC2026_DB.prepare(
                                'SELECT * FROM wc_group WHERE group_id = ? ORDER BY points DESC, gd DESC, gf DESC'
                            ).bind(gLetter).all(),
                            env.WC2026_DB.prepare('SELECT * FROM wc_third_place_standings').all(),
                        ]);
                        const standings  = standingsRes.status === 'fulfilled' ? standingsRes.value?.results : [];
                        const thirdPlace = thirdRes.status   === 'fulfilled' ? thirdRes.value?.results   : null;
                        if (standings?.length) {
                            g.advancementProb = computeAdvancementProb(
                                standings, g.home.name, g.away.name, wp, thirdPlace
                            );
                        }
                    } catch (_) {}
                }
            }

            // Crunch condition detection
            const scoreDiff = Math.abs(hGoals - aGoals);
            let crunchCondition = null;
            if      (sit.isShootout)                          crunchCondition = 'penalty_shootout';
            else if (sit.manAdvantage && scoreDiff <= 1)      crunchCondition = 'man_advantage';
            else if (sit.isStoppage   && scoreDiff <= 1)      crunchCondition = 'added_time';
            else if (sit.elapsed > 60 && scoreDiff > 0) {
                const loserWP = hGoals > aGoals ? wp.awayWin : wp.homeWin;
                if (loserWP < 0.15) crunchCondition = 'late_deficit';
            }
            if (crunchCondition) {
                g._crunch = crunchCondition;
                if (env.GAME_DO) {
                    try {
                        const doStub = env.GAME_DO.get(env.GAME_DO.idFromName(g.id));
                        doStub.fetch(new Request('https://field/crunch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ condition: crunchCondition, gameId: g.id, ts: Date.now() }),
                        })).catch(() => {});
                    } catch (_) {}
                }
            }
        }

        // GameDO WP state updates
        if (env.GAME_DO) {
            const liveWithWP = games.filter(g => g.state === 'live' && g.winProb);
            if (liveWithWP.length > 0) {
                const wpResults = await Promise.allSettled(
                    liveWithWP.map(async g => {
                        const doStub = env.GAME_DO.get(env.GAME_DO.idFromName(g.id));
                        const resp = await doStub.fetch(new Request('https://field/wp', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                wp:          g.winProb,
                                elapsed:     g.situation?.elapsed ?? null,
                                advanceProb: g.advancementProb ?? null,
                                ts:          Date.now(),
                            }),
                        }));
                        if (!resp.ok) return null;
                        return { g, state: await resp.json() };
                    })
                );
                for (const result of wpResults) {
                    if (result.status !== 'fulfilled' || !result.value?.state?.ok) continue;
                    const { g, state } = result.value;
                    g.openingWP          = state.openingWP          ?? null;
                    g.wpDelta            = state.wpDelta            ?? null;
                    g.recentWPHistory    = state.recentHistory      ?? [];
                    g.openingAdvanceProb = state.openingAdvanceProb ?? null;
                }
            }
        }

        // WC D1 auto-write — triggers writeWCResult for finished games
        if (env.WC2026_DB) {
            const finals = games.filter(g => g.state === 'final');
            if (finals.length > 0) {
                if (ctx?.waitUntil) {
                    ctx.waitUntil(Promise.allSettled(finals.map(g => writeWCResult(env.WC2026_DB, g, env, ctx))));
                } else {
                    await Promise.allSettled(finals.map(g => writeWCResult(env.WC2026_DB, g, env, ctx)));
                }
            }
        }

        return new Response(
            JSON.stringify({ sport, date, games, count: games.length, source: 'espn-wc', ts: Date.now() }),
            { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } }
        );
    }
    // ── end wc26 ESPN early-return ────────────────────────────────────────────
```

---

## TASK 4 — Replace eventsContext in writeWCResult (Gap A)

In `src/index.js`, find the eventsContext block in `writeWCResult` (approx L1842):
```js
        // Fetch match events (goals, cards, subs) from api-sports for richer brief
        let eventsContext = '';
        try {
            const numericId = String(game.id).replace('football:', '');
            const evRes = await fetch(
                `https://v3.football.api-sports.io/fixtures/events?fixture=${numericId}`,
                { headers: { 'x-apisports-key': env.APISPORTS_KEY || '' } }
            );
            if (evRes.ok) {
                const evData = await evRes.json();
                const events = evData?.response || [];
                const lines = events.map(ev => {
                    const min    = ev.time?.elapsed || '?';
                    const extra  = ev.time?.extra ? `+${ev.time.extra}` : '';
                    const player = ev.player?.name || '';
                    const assist = ev.assist?.name ? ` (${ev.assist.name} ast)` : '';
                    const team   = ev.team?.name || '';
                    const type   = ev.type || '';
                    const detail = ev.detail || '';
                    if (type === 'Goal') return `⚽ ${min}${extra}' ${player}${assist} — ${team}${detail === 'Own Goal' ? ' (OG)' : detail === 'Penalty' ? ' (PEN)' : ''}`;
                    if (type === 'Card' && detail === 'Red Card')    return `🟥 ${min}${extra}' ${player} — ${team}`;
                    if (type === 'Card' && detail === 'Yellow Card') return `🟨 ${min}${extra}' ${player} — ${team}`;
                    if (type === 'subst') return `🔄 ${min}${extra}' ${player} on for ${ev.assist?.name || '?'} — ${team}`;
                    return null;
                }).filter(Boolean);
                if (lines.length) eventsContext = '\n\nMATCH EVENTS:\n' + lines.join('\n');
            }
        } catch (_) {}
```

Replace the entire block with:
```js
        // Fetch match events (goals, cards) from ESPN summary keyEvents.
        // Replaces API-Sports /fixtures/events — richer text (includes shot
        // description and assist), zero extra credentials.
        // espnEventId is set by adaptESPNWCSoccer; falls back to stripping
        // the 'espn:' prefix for robustness.
        let eventsContext = '';
        try {
            const espnId = game.espnEventId || String(game.id).replace(/^(?:football|espn):/, '');
            if (espnId && !/\D/.test(espnId)) {   // numeric ESPN id only
                const summaryResp = await fetch(
                    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnId}`,
                    { signal: AbortSignal.timeout(4000) }
                );
                if (summaryResp.ok) {
                    const summaryData  = await summaryResp.json();
                    const KEY_TYPES    = new Set(['goal', 'yellow-card', 'red-card']);
                    const eventLines   = (summaryData.keyEvents || [])
                        .filter(e => KEY_TYPES.has(e.type?.type))
                        .map(e => {
                            const clock = (typeof e.clock === 'object' ? e.clock?.displayValue : '') || '';
                            const text  = e.text || '';
                            const t     = e.type?.type;
                            if (t === 'goal') {
                                const suffix = e.ownGoal ? ' (OG)' : e.penaltyKick ? ' (PEN)' : '';
                                return `⚽ ${clock} ${text}${suffix}`;
                            }
                            if (t === 'yellow-card') return `🟨 ${clock} ${text}`;
                            if (t === 'red-card')    return `🟥 ${clock} ${text}`;
                            return null;
                        }).filter(Boolean);
                    if (eventLines.length) eventsContext = '\n\nMATCH EVENTS:\n' + eventLines.join('\n');
                }
            }
        } catch (_) {}
```

---

## TASK 5 — Verify and commit

```bash
node --check src/index.js
```

If clean:
```bash
git add src/index.js
git commit -m "feat(wc26): switch v2/games from API-Sports to ESPN scoreboard

- adaptESPNWCSoccer(): ESPN event → standard game shape
  - id: 'espn:{ev.id}', espnEventId for downstream use
  - situation.elapsed from status.clock (seconds → minutes) [Gap B]
  - situation.isStoppage from displayClock.includes('+')
  - round: '' → extractWCGroup falls to _WC_TEAM_GROUP NFD fallback

- handleV2Games: espnLeague flag triggers early-return before APISPORTS_KEY gate
  - BSD enrichment, WP computation, crunch, GameDO, writeWCResult all preserved
  - source: 'espn-wc', Cache-Control: max-age=15 (matches football TTL)

- writeWCResult eventsContext: replace api-sports /fixtures/events with
  ESPN /summary keyEvents (goals + yellow/red cards with minute + full text) [Gap A]

APISPORTS_KEY still required for NBA, NHL, MLB, WNBA, EPL, MLS.
Rule 7 (single-concern commit)."
```

Then deploy:
```bash
wrangler deploy
```

---

## POST-DEPLOY VERIFICATION

```bash
BASE="https://field-relay-nba.jeffunglesbee.workers.dev"

# 1. Confirm ESPN source in response
curl -s "$BASE/v2/games?sport=wc26&date=$(date -u +%Y-%m-%d)" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('source:', d.get('source'))
print('count:', d.get('count'))
games=d.get('games',[])
for g in games:
    sit=g.get('situation')
    print(f'  {g[\"id\"]} {g[\"home\"][\"name\"]} {g[\"home\"][\"score\"]}-{g[\"away\"][\"score\"]} {g[\"away\"][\"name\"]} state={g[\"state\"]} elapsed={sit[\"elapsed\"] if sit else \"N/A\"}')
"

# 2. Confirm game IDs use espn: prefix
curl -s "$BASE/v2/games?sport=wc26&date=$(date -u +%Y-%m-%d)" \
  | python3 -c "import sys,json; games=json.load(sys.stdin).get('games',[]); print([g['id'] for g in games])"

# 3. Confirm D1 still writing (check wc_results after a game goes final)
curl -s "$BASE/wc/results" | python3 -c "
import sys,json
d=json.load(sys.stdin)
rows=d.get('results',[])
print(f'D1 rows: {len(rows)}')
recent=[r for r in rows if r.get('match_date','') >= '2026-06-26']
print(f'June 26+ rows: {len(recent)}')
for r in recent:
    print(f'  {r[\"match_date\"]} | {r[\"home\"]} {r[\"home_score\"]}-{r[\"away_score\"]} {r[\"away\"]}')
"

# 4. Confirm BracketDO received today's results
curl -s "$BASE/wc/bracket/state" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('resultCount:', d.get('resultCount')); print('lastResult:', d.get('lastResult'))"

# 5. Confirm /deploy/verify
curl -s "$BASE/deploy/verify" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d)"
```

---

## SCOPE BOUNDARY

DO:
- `src/index.js` only (adaptESPNWCSoccer, handleV2Games ESPN branch, writeWCResult eventsContext)

DO NOT:
- Touch `src/bracket-do.js`, `src/wc-tournament-projections.js`, `src/context-assembler.js`
- Touch client repo (jubilant-bassoon)
- Modify BSD enrichment logic
- Modify writeWCResult D1 logic (only replace the eventsContext fetch)
- Add any new API keys or env bindings

## NOTES

- `APISPORTS_KEY` remains required for NBA/NHL/MLB/WNBA/EPL/MLS — do not remove the key check
- The `_WC_TEAM_GROUP` fallback in `extractWCGroup` handles all 48 ESPN display names including
  Curaçao (NFD → curacao) and Türkiye (NFD → turkiye) — verified before build
- Knockout round ESPN event IDs will appear as `espn:{id}` in D1 wc_results for new rows;
  existing group-stage rows remain `football:{id}` — mixed is fine, wc_results is queried
  by team+date not game_id
- `computeLiveWP` with `homeSOT=0, awaySOT=0` falls back to pre-game lambda blending
  from Odds API — this is the correct degradation path and produces reasonable WP
  estimates based on elapsed time and score alone
