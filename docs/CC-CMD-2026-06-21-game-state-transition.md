# Claude Code Command — Game State Transition Hook

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-game-state-transition-2026-06-21.md.

## CONTEXT

When a game transitions from pre-game to live (kickoff, first pitch),
the closing odds disappear from The Odds API within minutes. FIELD
has no mechanism to snapshot them at that moment. Every game played
without this hook loses its closing odds permanently. The Odds Story
feature needs closing odds to show "line moved from X to Y."

AmbientDO already polls ESPN for live scores and detects `final`
state transitions (src/ambient-do.js line 367, `_finals` set). But
it does NOT detect `pre→live` transitions. This command adds that
detection and captures closing odds on the transition.

## ADR-002 STATUS: CLEAN

Closing odds are factual data captured at a specific moment. No
drama scoring, no interest calculation. Same pattern as the existing
opening_odds capture.

## PRE-BUILD PROBE (Rule 68 — PROBE-FIRST-A)

```bash
# 1. Read AmbientDO score tracking to understand state detection
grep -n "_scores\[gameId\]\|prev\.\|state.*live\|state.*final\|_finals" src/ambient-do.js | head -20

# 2. Check the Odds API sport mapping
grep -A15 "ODDS_SPORT_KEYS" src/ambient-do.js

# 3. Find how _fetchLiveOdds works (we'll use the same pattern)
grep -n "_fetchLiveOdds\|buildUrl\|ODDS_API_KEY" src/ambient-do.js | head -15

# 4. Check how reconcile() is imported/used in the main relay
grep -n "import.*reconcile\|reconcile(env" src/index.js | head -10

# 5. Check the archive game table schema for closing_odds column
grep -n "closing_odds" src/index.js | head -10

# 6. Verify The Odds API supports filtering by event ID
# (reduces cost from 1 credit per sport to 1 credit per game)
# This is a documentation check, not a live probe.
```

Write probe results to outbox BEFORE writing any code.

## TASK 1: Add pre→live transition detection in AmbientDO

In `src/ambient-do.js`, inside the ESPN poll loop where scores are
tracked (around line 298-311), add detection for when a game
transitions from pre-game to live:

```javascript
// After: const prev = this._scores[gameId];
// After: existing score tracking logic

// Detect pre→live transition (game just started)
const prevState = prev?.state || 'pre';
const isNewLive = (state === 'live' || state === 'in') &&
                  prevState !== 'live' && prevState !== 'in';
if (isNewLive && !this._gameStarts?.has(gameId)) {
    if (!this._gameStarts) this._gameStarts = new Set();
    this._gameStarts.add(gameId);
    pendingStarts.push({ gameId, sport, home, away });
}
```

Initialize `pendingStarts` array at the top of the poll function
(alongside any existing arrays like `pendingFinals`).

## TASK 2: Capture closing odds on pre→live transition

After the ESPN poll loop completes, process any pending starts by
fetching closing odds from The Odds API:

```javascript
// After the pendingFinals processing block:

// Capture closing odds for games that just went live
if (pendingStarts.length > 0 && this.env.ODDS_API_KEY) {
    for (const start of pendingStarts) {
        try {
            await this._captureClosingOdds(start);
        } catch (e) {
            console.warn('[AmbientDO] closing odds capture failed:', e.message);
        }
    }
}
```

Add the `_captureClosingOdds` method to the AmbientDO class:

```javascript
async _captureClosingOdds({ gameId, sport, home, away }) {
    const oddsKey = ODDS_SPORT_KEYS[sport];
    if (!oddsKey) return; // Sport not covered by Odds API

    const apiKey = this.env.ODDS_API_KEY;
    const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/odds`
        + `?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals`
        + `&oddsFormat=american`;

    const r = await fetch(url, {
        headers: { 'User-Agent': 'FIELD-relay/2026' },
        cf: { cacheTtl: 0 },
    });
    if (!r.ok) {
        console.warn(`[closing-odds] fetch ${r.status} for ${sport}`);
        return;
    }

    const events = await r.json();
    // Match the event by team names
    const norm = s => (s||'').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const event = events.find(e =>
        (norm(e.home_team).includes(norm(home)) || norm(home).includes(norm(e.home_team))) &&
        (norm(e.away_team).includes(norm(away)) || norm(away).includes(norm(e.away_team)))
    );
    if (!event?.bookmakers?.length) return;

    // Extract moneyline + spread + total from first bookmaker
    const bk = event.bookmakers[0];
    const ml = bk.markets?.find(m => m.key === 'h2h');
    const sp = bk.markets?.find(m => m.key === 'spreads');
    const to = bk.markets?.find(m => m.key === 'totals');
    const odds = {
        source: bk.key,
        captured_at: new Date().toISOString(),
        moneyline: {
            home: ml?.outcomes?.find(o => o.name === event.home_team)?.price ?? null,
            away: ml?.outcomes?.find(o => o.name === event.away_team)?.price ?? null,
            draw: ml?.outcomes?.find(o => o.name === 'Draw')?.price ?? null,
        },
        spread: {
            home: sp?.outcomes?.find(o => o.name === event.home_team)?.point ?? null,
            away: sp?.outcomes?.find(o => o.name === event.away_team)?.point ?? null,
        },
        total: {
            over: to?.outcomes?.find(o => o.name === 'Over')?.point ?? null,
            under: to?.outcomes?.find(o => o.name === 'Under')?.point ?? null,
        },
    };

    // Write closing_odds to both archive tables via relay endpoint
    // AmbientDO can't call reconcile() directly (it's in index.js),
    // so use the D1 execute path through the relay.
    const json = JSON.stringify(odds);
    for (const table of ['regular_season_games', 'postseason_games']) {
        try {
            // Find the game row by team names + today's date
            const today = new Date().toISOString().slice(0, 10);
            const findSql = `SELECT id FROM ${table} WHERE date = ? AND closing_odds IS NULL LIMIT 10`;
            const findRes = await this._d1Query(findSql, [today]);
            // Match by team name in the id (archive ids contain normalized team names)
            const normHome = norm(home), normAway = norm(away);
            const match = (findRes || []).find(r =>
                r.id && (r.id.includes(normHome) || r.id.includes(normAway))
            );
            if (match) {
                await this._d1Query(
                    `UPDATE ${table} SET closing_odds = ? WHERE id = ? AND closing_odds IS NULL`,
                    [json, match.id]
                );
                // Log to change_log for Brief Freshness Guard
                await this._d1Query(
                    `INSERT INTO change_log (game_id, source, field, old_value, new_value, ts)
                     VALUES (?, 'closing_odds_capture', 'closing_odds', NULL, ?, datetime('now'))`,
                    [match.id, json]
                ).catch(() => {}); // change_log may not exist
                console.log(`[closing-odds] captured for ${home} vs ${away} → ${match.id}`);
            }
        } catch (_) { /* table may not have this game */ }
    }
}

// Helper: D1 query via relay /d1/execute
async _d1Query(sql, params = []) {
    // Check if ARCHIVE_DB binding is available directly
    if (this.env.ARCHIVE_DB) {
        const res = await this.env.ARCHIVE_DB.prepare(sql).bind(...params).all();
        return res.results || [];
    }
    return [];
}
```

IMPORTANT ADAPTATION NOTE: AmbientDO is a Durable Object. Check
whether it has ARCHIVE_DB binding in wrangler.toml. If not, it
can't query D1 directly. In that case, use fetch() to the relay's
/d1/execute endpoint instead:

```bash
# Probe: does AmbientDO have ARCHIVE_DB binding?
grep -A10 "AMBIENT_DO\|ambient_do\|AmbientDurableObject" wrangler.toml
```

If AmbientDO does NOT have ARCHIVE_DB binding, the _d1Query
helper should use fetch() against the relay's /d1/execute
endpoint (same pattern as odds-backfill.js).

## TASK 3: Budget guard

The Odds API fetch costs 1 credit per sport request. With ~15 games
per day across all sports, this adds ~15 credits/day to the budget.
The daily ceiling is 2700 (Rule 78 / API-COST-A).

Add a daily counter to prevent runaway costs:

```javascript
// In AmbientDO class:
_closingOddsToday = 0;
_closingOddsDate = '';

// In _captureClosingOdds, before the fetch:
const today = new Date().toISOString().slice(0, 10);
if (this._closingOddsDate !== today) {
    this._closingOddsDate = today;
    this._closingOddsToday = 0;
}
if (this._closingOddsToday >= 30) {
    console.warn('[closing-odds] daily cap reached (30)');
    return;
}
this._closingOddsToday++;
```

## TASK 4: Verify

```bash
# Build check
node --check src/ambient-do.js

# Deploy
wrangler deploy

# Health check
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health | grep "RELAY OK"
```

Verification of the actual closing odds capture requires a game to
transition from pre→live. This will happen naturally on the next
game start. The console logs will show
`[closing-odds] captured for X vs Y → id`.

## SCOPE BOUNDARY (Rule 69 — TOUCH-ONLY-A)

DO:
- Add pre→live transition detection in AmbientDO poll loop
- Add _captureClosingOdds method to AmbientDO class
- Add _d1Query helper (or fetch-based equivalent)
- Add daily budget counter

DO NOT:
- Modify the existing `final` state detection
- Modify BracketDO
- Modify the journalism prompt builder
- Touch src/index.js (all changes in src/ambient-do.js)
- Modify The Odds API live polling (_fetchLiveOdds)
- Change any opening_odds logic

## INSTRUCTIONS

1. Single-repo task: field-relay-nba only.
2. Pre-build probes FIRST. Write probe results to outbox.
3. All changes in src/ambient-do.js (single file).
4. node --check before commit.
5. Single commit: "feat: game state transition hook — closing odds capture on pre→live"
6. Deploy via wrangler deploy.
7. Write manifest to outbox/cc-game-state-transition-2026-06-21.md.

## KEY CONSTRAINT: ODDS API COST

Each closing odds fetch costs 1 credit (same as current endpoint).
The daily cap of 30 captures limits total cost to 30 credits/day.
This is ~1% of the 2700 daily budget. If the budget is tight,
_captureClosingOdds can check the remaining quota via the
x-requests-remaining header (same pattern as _fetchLiveOdds).

## TEAM NAME MATCHING

The Odds API uses different team names than ESPN/FIELD. The existing
norm() function in AmbientDO handles NFD normalization + alphanumeric
extraction. Use bidirectional substring matching (norm(a).includes(norm(b))
|| norm(b).includes(norm(a))) for robustness.

The existing _wcMatchTeamName aliases (client-side) handle known
mismatches like "Turkey"↔"Türkiye", "Czech Republic"↔"Czechia",
"DR Congo"↔"Congo DR". AmbientDO may need similar aliases if
matches fail. Document any missed matches in the outbox manifest.
