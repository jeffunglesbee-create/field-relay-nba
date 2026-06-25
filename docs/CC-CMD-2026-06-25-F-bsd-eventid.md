# CC-CMD F: BSD Event ID Enrichment
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Rule 87:** Self-completing.

## WHY THIS EXISTS

CC-CMDs A–D shipped the full BSD integration layer:
- `/bsd/events/:id/shotmap` → per-shot xG coordinates
- `/bsd/events/:id/momentum` → minute-by-minute pressure index
- `/bsd/events/:id/incidents` → goal build-up sequences
- `buildBSDMomentumContext` → CONTEXT_SOURCES priority 8, all soccer + atp/wta
- `AmbientDO._bsdSubscribe` → live ball tracking WebSocket fan-out

Every one of these is dormant. They all read `game.bsdEventId` which is never set.
Game objects from `adaptFootball` have no BSD identifier — they only carry
API-Sports fixture IDs. Without this enrichment, the entire BSD stack is an
empty pipe.

USA vs Türkiye is live tonight (2026-06-26 02:00 UTC). This CC-CMD must ship
before kickoff to have live BSD context in the journalism brief.

## WHAT THIS DOES

One addition to the football branch in `handleV2Games`: after fixtures are
adapted, fetch BSD live events in parallel (3s timeout, non-blocking), match
by team name via the existing `teamNameMatch`/`resolveTeamKey` functions, and
inject `bsdEventId` into each matched game object.

Scope: all football/soccer sports (wc26, epl, mls, ucl, laliga, seriea,
bundesliga, ligue1) — same sports where buildBSDMomentumContext fires.

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba && git pull

# 1. Confirm no bsdEventId exists anywhere in index.js yet
grep -n 'bsdEventId' src/index.js | head -10
# Expected: 0 lines (field does not exist)

# 2. Confirm insertion point exists exactly
grep -n 'Adapt all fixtures — live ones with stats' src/index.js
# Expected: 1 line at ~L2642

# 3. Confirm wcLambdas line is immediately after (str_replace anchor)
grep -n 'Pre-fetch WC pre-game lambdas' src/index.js
# Expected: 1 line at ~L2645

# 4. Confirm teamNameMatch is module-level (accessible from handleV2Games)
grep -n 'function teamNameMatch' src/index.js
# Expected: 1 line at ~L974

# 5. Confirm BSD_API_TOKEN in deploy secrets
grep 'BSD_API_TOKEN' .github/workflows/deploy.yml | head -3
# Expected: 2 refs (secrets list + env block)

# 6. Confirm BSD live relay route exists
grep -n "pathname === '/bsd/events/live'" src/index.js | head -2
# Expected: 1 line confirming route is wired

# 7. Live relay probe (no live soccer right now — count=0 is expected)
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live
# Expected: {"count":0,"events":[]} or similar valid JSON
```

## TASK 1 — Inject BSD event ID enrichment in handleV2Games

**str_replace in src/index.js:**

OLD (exact match, ~L2642-2646):
```
            // Adapt all fixtures — live ones with stats attached (Gap 1+2)
            games = raw.map(f => adaptFootball(f, sport, statsMap[f?.fixture?.id] || null));

            // Pre-fetch WC pre-game lambdas once (non-blocking; degrades gracefully if unavailable)
            const wcLambdas = sport === 'wc26' ? await getWCPregameLambdas(env) : null;
```

NEW:
```
            // Adapt all fixtures — live ones with stats attached (Gap 1+2)
            games = raw.map(f => adaptFootball(f, sport, statsMap[f?.fixture?.id] || null));

            // ── BSD event ID enrichment ───────────────────────────────────────────
            // Fetches BSD live events and matches to game objects by team name via
            // teamNameMatch/resolveTeamKey (same normalization as odds matching).
            // Injects bsdEventId which activates all dormant BSD features:
            //   • buildBSDMomentumContext (CONTEXT_SOURCES priority 8)
            //   • AmbientDO._bsdSubscribe (live ball tracking WebSocket)
            //   • /bsd/events/:id/shotmap, /momentum, /incidents relay routes
            // 3s timeout — never blocks the V2 game response.
            // Non-blocking — failure leaves bsdEventId undefined; features degrade silently.
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
                        const _bsdLive = await _bsdR.json();
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
                } catch (_) {} // Non-blocking — BSD outage never breaks V2 games
            }

            // Pre-fetch WC pre-game lambdas once (non-blocking; degrades gracefully if unavailable)
            const wcLambdas = sport === 'wc26' ? await getWCPregameLambdas(env) : null;
```

NOTE: Variables prefixed `_` to avoid any accidental collision with outer
scope. The `catch (_)` uses `_` as convention matching existing relay patterns.

## TASK 2 — Smoke assertion

Add after the last existing smoke assertion in the relay smoke block:

```javascript
// A_BSD_6: bsdEventId enrichment present in handleV2Games football branch
assert('A_BSD_6 — bsdEventId enrichment in handleV2Games',
  src.includes('bsdEventId = String(_bsdMatch.id)') &&
  src.includes('AbortSignal.timeout(3000)') &&
  src.includes('BSD event ID enrichment'),
  'handleV2Games must inject bsdEventId from BSD live events for all soccer sports');
```

## DONE CONDITIONS

```bash
# 1. Smoke passes
node smoke.js 2>&1 | tail -3
# Expected: N passed, 0 failed

# 2. bsdEventId present in 3 locations (enrichment assign + smoke string checks)
grep -c 'bsdEventId' src/index.js
# Expected: ≥ 1 (the g.bsdEventId assignment)

# 3. BSD enrichment block present
grep -n 'BSD event ID enrichment' src/index.js
# Expected: 1 line

# 4. Timeout guard present
grep -n 'AbortSignal.timeout(3000)' src/index.js
# Expected: 1 line

# 5. diff — src/index.js only (no other files)
git diff --stat
# Expected: src/index.js only (+~30 lines)

# 6. Live probe: /v2/games?sport=wc26 should include bsdEventId when BSD has live events
# Right now BSD count=0 so bsdEventId will be absent — that is correct behavior
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wc26 \
  | python3 -c "import json,sys; d=json.load(sys.stdin); g=d.get('games',[]); \
    print(f'{len(g)} games'); \
    [print(f'  {x.get(\"home\",{}).get(\"name\",\"?\")}: bsdEventId={x.get(\"bsdEventId\",\"NOT SET\")}') for x in g[:3]]"
# Expected: games list, bsdEventId=NOT SET (correct — no BSD live events right now)
# When USA vs Turkey kicks off tonight, bsdEventId will populate automatically
```

## WHAT ACTIVATES AFTER DEPLOY

When the first WC game goes live tonight:

1. `/v2/games?sport=wc26` returns game objects with `bsdEventId` set
2. `buildBSDMomentumContext` reads `game.bsdEventId`, fetches momentum, injects
   `[BSD MOMENTUM]` block into every WC journalism brief automatically
3. Client can POST `{ event_id: game.bsdEventId }` to `/ambient/bsd/subscribe`
   to start receiving live ball position frames
4. Post-game: shotmap and incidents available via relay routes

No further code needed. The entire dormant stack activates from this one field.

## COMMIT

```bash
git add src/index.js
git commit -m "feat(bsd): inject bsdEventId via live event match in handleV2Games"
git push origin main
```

Single file, single commit.
