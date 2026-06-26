# CC-CMD: AFL Migration + Three-Source Integration (ESPN + Kali + Squiggle)
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing

## CONTEXT

Three sources, three roles, fully integrated:

  ESPN  australian-football/afl → live scores/schedule, 7 games confirmed,
        team abbreviations (HAW/CARL/COLL/BL), per-quarter linescores, venues
        ev.week.number = round → join key into Kali + Squiggle

  Kali  /kali/predictions?year=Y&round=R → composite win probability +
        factors[] with human-readable win reasons (impact-scored)
        /kali/tips?year=Y&round=R → 30-model tipping consensus per game
        Cached 3600s at CF edge (KALI_AFL_TOKEN already deployed)

  Squiggle  ?q=tips;year=Y;round=R → source="Aggregate" = cross-model consensus
        Unique analytics: power rankings, projected ladder (not in Kali)
        Cached via existing squiggleTtl (3600s for tips)

Integration: after ESPN games adapted, fetch Kali + Squiggle in parallel
for the round, match by team name via existing teamNameMatch(), attach
game.journalism = { kali: {...}, squiggle: {...} } to each game object.
Downstream context builders read game.journalism without extra API calls.

Sources confirmed 2026-06-26:
  ESPN: 7 AFL Round 16 events, ev.week.number=16 ✅
  Kali: /predictions R16 → 7 predictions with factors[] ✅
  Kali: /tips R16 → 210 tips (30 models × 7 games) ✅
  Squiggle: Aggregate tip confirmed per game with hconfidence ✅

FIVE CHANGES to src/index.js:
  1. V2_LEAGUES 'afl' → ESPN
  2. Adapter dispatch → add 'australian-football' to basketball branch
  3. adaptESPNBasketball → add round field, fix league label for AFL
  4. New buildAFLJournalismContext() function
  5. Wire buildAFLJournalismContext into ESPN branch post-adapt

## PRE-BUILD PROBE

```bash
node --check src/index.js

# Confirm ESPN AFL coverage
curl -s "https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard" \
  | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('round:', d.get('week',{}).get('number'))
print('events:', len(d.get('events',[])))
"
# Expected: round: 16, events: 7

# Confirm Kali predictions for round
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/kali/predictions?year=2026&round=16&limit=3" \
  | python3 -c "
import sys,json; d=json.load(sys.stdin)
p=d['data'][0]
print(p['homeTeam'],'vs',p['awayTeam'],'→',p['homeProbability'],'%')
print('factors:',[f['label'] for f in p.get('factors',[])])
"

# Confirm Squiggle Aggregate tip
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/squiggle?q=tips;year=2026;round=16" \
  | python3 -c "
import sys,json; d=json.load(sys.stdin)
agg=[t for t in d.get('tips',[]) if t.get('source')=='Aggregate']
print(f'{len(agg)} aggregate tips')
if agg: print(agg[0])
"
```

## CHANGE 1 — V2_LEAGUES: update afl entry

Find:
```
    // AFL Premiership (verified June 20 2026 via /apisports/afl/leagues — id:1,
    // season:2026 current:true). The api-sports AFL plan accepts only ?date=
    // (no league/season filter) on a ±1 day rolling window; the dispatch in
    // handleV2Games branches AFL to use ?date= only.
    'afl':          { sport: 'afl',        leagueId: 1,   season: 2026        },
```

Replace with:
```
    // AFL — migrated June 26 2026: API-Sports → ESPN australian-football/afl
    // Three-source architecture: ESPN (scores) + Kali (journalism) + Squiggle (analytics)
    // ev.week.number from ESPN is the round join key into Kali + Squiggle.
    // Squiggle /squiggle route stays active for power rankings + projected ladder.
    // KALI_AFL_TOKEN already deployed. bsdLeagueId: null (AFL not in BSD).
    'afl':          { sport: 'afl', espnLeague: 'afl', espnSport: 'australian-football', season: 2026 },
```

## CHANGE 2 — Adapter dispatch: add australian-football to basketball branch

Find:
```
                cfg.espnSport === 'baseball'    ? adaptESPNMLB(ev)
                : cfg.espnSport === 'basketball' ? adaptESPNBasketball(ev, sport)
                : adaptESPNWCSoccer(ev, sport)
```

Replace with:
```
                cfg.espnSport === 'baseball'                                        ? adaptESPNMLB(ev)
                : ['basketball','australian-football'].includes(cfg.espnSport)       ? adaptESPNBasketball(ev, sport)
                : adaptESPNWCSoccer(ev, sport)
```

## CHANGE 3 — adaptESPNBasketball: add round field, fix league label

Find (the return statement inside adaptESPNBasketball):
```
        league:      sportKey === 'nba' ? 'NBA' : 'WNBA',
```

Replace with:
```
        league:      ({ nba:'NBA', afl:'AFL', wnba:'WNBA' })[sportKey] || 'WNBA',
```

Then find (still inside adaptESPNBasketball, the linescores block):
```
        linescores: {
            home: ls(home.linescores),
            away: ls(away.linescores),
        },
    };
}
```

Replace with:
```
        linescores: {
            home: ls(home.linescores),
            away: ls(away.linescores),
        },
        // round: from ESPN ev.week.number — join key for Kali + Squiggle lookups
        round: ev.week?.number ?? null,
    };
}
```

## CHANGE 4 — Add buildAFLJournalismContext() function

Insert immediately BEFORE the handleV2Games function definition:

```js
// ── buildAFLJournalismContext ─────────────────────────────────────────────────
// Fetches Kali predictions + Squiggle aggregate tips for a given AFL round
// and matches results to ESPN game objects by team name.
// Called once per /v2/games?sport=afl request; both sources cached at CF edge.
//
// Sources (all confirmed 2026-06-26):
//   Kali /predictions  → homeProbability, awayProbability, factors[], homeBreakdown
//   Kali /tips         → 30-model tipping consensus per game (hconfidence 0-100)
//   Squiggle ?q=tips   → source="Aggregate" cross-model consensus hconfidence
//
// Returns: Map<gameId, { kali?: {...}, squiggle?: {...} }>
// Non-blocking: failure of either source leaves that slot null (degrades gracefully).
async function buildAFLJournalismContext(games, round, year, env) {
    if (!round || !year || !games.length) return {};
    const ctx = {};

    // Initialise context slots keyed by espnEventId for O(1) attachment
    for (const g of games) {
        if (g.espnEventId) ctx[g.espnEventId] = { kali: null, squiggle: null };
    }

    // Team name normaliser — strips common AFL suffixes for fuzzy matching
    const _norm = s => String(s || '').toLowerCase()
        .replace(/\b(lions|swans|eagles|hawks|magpies|bombers|cats|blues|tigers|bulldogs|kangaroos|power|crows|demons|dockers|suns|giants|suns|saints|roos)\b/g, '')
        .replace(/[^a-z]/g, '').slice(0, 6);

    // Find ESPN game matching a Kali/Squiggle team name pair
    const findGame = (homeTeam, awayTeam) => games.find(g =>
        (teamNameMatch(homeTeam, g.home.name) && teamNameMatch(awayTeam, g.away.name)) ||
        (teamNameMatch(homeTeam, g.away.name) && teamNameMatch(awayTeam, g.home.name)) ||
        (_norm(homeTeam) && _norm(homeTeam) === _norm(g.home.name)) ||
        (_norm(homeTeam) && _norm(homeTeam) === _norm(g.away.name))
    );

    // Fetch Kali predictions + Squiggle tips in parallel (both CF-edge cached)
    const kaliKey = env.KALI_AFL_TOKEN;
    const [kaliResp, squiggleResp] = await Promise.allSettled([
        kaliKey
            ? fetch(`${KALI_BASE}/predictions?year=${year}&round=${round}`, {
                headers: { 'Authorization': `Bearer ${kaliKey}`, 'Accept': 'application/json' },
                cf: { cacheTtl: 3600, cacheEverything: true,
                      cacheKey: `kali:predictions:${year}:${round}` },
              })
            : Promise.reject(new Error('KALI_AFL_TOKEN not set')),
        fetch(`${SQUIGGLE_BASE}/?q=tips;year=${year};round=${round}`, {
            headers: SQUIGGLE_HEADERS,
            cf: { cacheTtl: squiggleTtl(`q=tips;year=${year};round=${round}`),
                  cacheEverything: true,
                  cacheKey: `squiggle:tips:${year}:${round}` },
        }),
    ]);

    // ── Kali predictions ────────────────────────────────────────────────────
    if (kaliResp.status === 'fulfilled' && kaliResp.value.ok) {
        try {
            const kd = await kaliResp.value.json();
            for (const pred of (kd.data || [])) {
                const g = findGame(pred.homeTeam, pred.awayTeam);
                if (!g?.espnEventId || !ctx[g.espnEventId]) continue;
                ctx[g.espnEventId].kali = {
                    homeWinPct:        pred.homeProbability,
                    awayWinPct:        pred.awayProbability,
                    squiggleConsensus: pred.squiggleConsensus,  // Kali's agg of tipsters
                    factors:           pred.factors || [],       // [{team,label,impact}]
                    homeBreakdown:     pred.homeBreakdown || {}, // {h2h,form,stats,venue}
                    awayBreakdown:     pred.awayBreakdown || {},
                };
            }
        } catch (_) {}
    }

    // ── Squiggle Aggregate tips ─────────────────────────────────────────────
    // source="Aggregate" is Squiggle's own cross-model consensus per game.
    if (squiggleResp.status === 'fulfilled' && squiggleResp.value.ok) {
        try {
            const sd = await squiggleResp.value.json();
            const aggTips = (sd.tips || []).filter(t => t.source === 'Aggregate');
            for (const tip of aggTips) {
                const g = findGame(tip.hteam, tip.ateam);
                if (!g?.espnEventId || !ctx[g.espnEventId]) continue;
                // hconfidence = % chance home team wins (0-100)
                ctx[g.espnEventId].squiggle = {
                    homeConfidence: tip.hconfidence,
                    awayConfidence: 100 - tip.hconfidence,
                };
            }
        } catch (_) {}
    }

    return ctx;
}
```

## CHANGE 5 — Wire buildAFLJournalismContext into the ESPN branch

After the adapter dispatch block, find the existing BSD by-date enrichment guard:
```
        // ── BSD group_name + weather enrichment ──────────────────────────────
```

Insert BEFORE it:

```js
        // ── AFL journalism context (ESPN + Kali + Squiggle) ──────────────────
        // Fires only for AFL — other sports use BSD or no enrichment.
        // round from top-level ESPN response (ev.week.number also set per-game
        // by adaptESPNBasketball, but scoreboard-level is available sooner).
        if (sport === 'afl' && env.KALI_AFL_TOKEN) {
            try {
                const _aflRound = espnData.week?.number ?? games[0]?.round ?? null;
                const _aflYear  = cfg.season ?? new Date().getUTCFullYear();
                const _aflCtx   = await buildAFLJournalismContext(games, _aflRound, _aflYear, env);
                for (const g of games) {
                    if (g.espnEventId && _aflCtx[g.espnEventId]) {
                        g.journalism = _aflCtx[g.espnEventId];  // { kali, squiggle }
                    }
                }
            } catch (_) { /* non-blocking — journalism context optional */ }
        }
```

## DONE CONDITIONS

1. node --check src/index.js passes
2. grep -n "kali-probe" src/index.js → 0 (already removed)
3. After deploy:

```bash
# Primary: AFL on ESPN with journalism context
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=afl" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
games=d.get('games',[])
print('source:', d.get('source'))
print('games:', len(games))
if games:
    g=games[0]
    print('abbr:', g.get('away',{}).get('abbr','?'),'@',g.get('home',{}).get('abbr','?'))
    print('venue:', g.get('venue','?'))
    print('round:', g.get('round','?'))
    print('espnEventId:', bool(g.get('espnEventId')))
    j=g.get('journalism',{})
    if j.get('kali'):
        k=j['kali']
        print('kali.homeWinPct:', k.get('homeWinPct'))
        print('kali.factors:', [f[\"label\"] for f in k.get('factors',[])[:2]])
    if j.get('squiggle'):
        print('squiggle.homeConfidence:', j['squiggle'].get('homeConfidence'))
"
# Expected:
#   source: espn-wc
#   games: 5-7
#   abbr: GWS @ HAW (or similar)
#   venue: MCG (not empty — was always empty with API-Sports)
#   round: 16
#   espnEventId: True
#   kali.homeWinPct: 79.0 (or similar)
#   kali.factors: ['Strong form...', 'Dominant H2H...']
#   squiggle.homeConfidence: 79

# Regression: WNBA still on ESPN, basketball adapter unchanged
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wnba" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('wnba source:', d.get('source'), 'games:', len(d.get('games',[])))"

# Regression: WC26 still working
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wc26" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('wc26 games:', len(d.get('games',[])))"

4. Commit: "feat(afl): ESPN + Kali + Squiggle three-source integration — scores + journalism + analytics"
