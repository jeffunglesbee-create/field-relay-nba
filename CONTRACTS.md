# CONTRACTS.md — Cross-System Data Contracts

> **This file must be identical in jubilant-bassoon AND field-relay-nba.**
> If you update one, update the other. Both CC sessions read their own
> repo's copy. A mismatch causes silent failures at system boundaries.

Last synced: 2026-06-21

---

## bracket:updated (WebSocket)

Producer: BracketDO (`src/bracket-do.js`)
Consumer: jubilant-bassoon `_handleMessage` in BracketDO WebSocket client

```
{
  type:        "bracket:updated"
  isLive:      boolean          // true = provisional (live goal), false = canonical (game final)
  delta: {
    significant: boolean        // any team shifted ≥ 5pp
    maxChampShift: number       // largest abs champDelta in pp
    shifts: [{
      name:        string       // canonical team name ("England")
      team:        string       // alias = name (client reads this)
      fifaCode:    string       // "ENG"
      group:       string       // "Group L"
      champBefore: number       // pp (e.g. 3.7)
      champAfter:  number       // pp (e.g. 4.2)
      champDelta:  number       // pp (e.g. 0.5) — relay canonical
      pChampDelta: number       // 0-1 scale (e.g. 0.005) — client alias
      advBefore:   number       // pp
      advAfter:    number       // pp
      advDelta:    number       // pp
    }]
    narrativeSeeds: string[]    // human-readable, for journalism queue
    triggerGame: object|null    // the game that triggered this recomputation
  }
  sourceGroup: string           // group of the scoring game (for CASCADE filtering)
  trigger:     string           // "USA 2-1 Paraguay (67')"
  ts:          number           // Date.now()
}
```

Client rules:
- CASCADE filters `delta.shifts` to `s.group !== sourceGroup`
- CASCADE threshold: `Math.abs(s.pChampDelta) >= 0.005`
- Re-render bracket tab on ANY bracket:updated (isLive or not)
- isLive=true → show CASCADE narrative; isLive=false → skip CASCADE

---

## AmbientDO SSE events (/live/ambient)

Producer: AmbientDO (`src/ambient-do.js`)
Consumer: jubilant-bassoon `AmbientEventSource` (~line 26124)

### Event: score
```
{
  gameId:      string    // "mlb_2026-06-21_nyymets_balorioles"
  sport:       string    // "MLB", "NBA", "wc26", etc.
  home:        string    // "New York Mets"
  away:        string    // "Baltimore Orioles"
  homeScore:   number
  awayScore:   number
  period:      string    // "5th", "Q3", "2H"
  periodLabel: string    // "5th Inning", "3rd Quarter"
  clock:       string    // "2:34" or ""
  state:       string    // "live" or "in"
}
```

### Event: lead_change
```
{
  gameId:    string
  sport:     string
  home:      string
  away:      string
  prevLeader: string     // team name
  newLeader:  string     // team name
  scoreline:  string     // "NYM 4-3 BAL"
}
```

### Event: final
```
{
  gameId:    string
  sport:     string
  home:      string
  away:      string
  homeScore: number
  awayScore: number
  winner:    string     // team name or "draw"
}
```

### Event: wp_update
```
{
  gameId:      string
  sport:       string
  home:        string
  away:        string
  homeWP:      number    // 0-1
  awayWP:      number    // 0-1
  drawWP:      number    // 0-1 (soccer only)
  wpDelta:     number    // signed, home perspective
  peakCollapse: number   // how far WP fell from peak
  urgency:     number    // composite urgency score
  confidence:  number    // model confidence
  ts:          number
}
```

### Event: all_final
```
{
  count: number    // total games that went final
  date:  string    // ISO date
}
```

### Event: connected
```
{
  liveGames: [{
    gameId, sport, home, away, homeScore, awayScore,
    period, clock, state
  }]
}
```

Client rules:
- Score/lead_change → write to espnScores + _sseScoreTs buffer
- wp_update → write to espnScores._liveOddsWP + dispatch field:wp_update
- Coalesced render via _sseRenderTimer (200ms for score, 80ms for WP)
- _sseScoreTs stores {type, ts, data?} objects (migrated June 21)
- Pulse Chip reads _sseScoreTs for 5-min window events

---

## _sseScoreTs event buffer

Producer: AmbientEventSource handlers in jubilant-bassoon
Consumer: getPulseChip(), _getVelocity()

```
Map<gameId: string, Array<{
  type:  "score" | "lead_change" | "wp_update"
  ts:    number     // Date.now()
  data?: object     // wp_update includes {homeWP, awayWP, wpDelta}
}>>
```

Max 20 entries per game. Pruned on read (8-min window for velocity,
5-min window for Pulse Chip).

---

## Pulse Chip signal priority

Producer: getPulseChip(gameId, espnGame) in jubilant-bassoon
Consumer: game card template

Priority order (first match wins):
1. ⚡ Lead changes (≥2 in 5 min)
2. 🔥 Scoring run (≥3 scores in 5 min)
3. 📊 Odds velocity (wp_update totalDelta ≥ 0.08)
4. ⚾ MLB situation (2 out, runners on, margin ≤ 2)

Returns: `{icon: string, text: string}` or `null`
Renders only when `espnGame.state === 'in'`

---

## Game table odds columns

Producer: odds-backfill.js sync step + relay live capture
Consumer: jubilant-bassoon buildOddsStory()

```
opening_odds: JSON string
closing_odds: JSON string

{
  source:      string    // "draftkings", "odds-api-historical", etc.
  captured_at: string    // ISO timestamp
  moneyline: {
    home: number         // American format (-150, +130)
    away: number
    draw?: number        // soccer only
  }
  spread?: {
    home: number
    away: number
  }
  total?: {
    over: number
    under: number
  }
}
```

Note: historical backfill writes the SAME data to both columns
(one snapshot serves as both opening and closing for completed games).
Live capture (future) will write opening on first sight, closing at
game start.

---

## /d1/execute endpoint

Producer: GitHub Actions scripts (odds-backfill.js)
Consumer: field-relay-nba relay worker

```
POST /d1/execute
Headers: X-FIELD-Relay: field-relay-cron-2026
Body: { sql: string, params?: any[] }

Response: { success: boolean, results: any[], meta: object }

Table allowlist: odds_history, odds_backfill_progress,
  regular_season_games, postseason_games
```

SELECT uses .all(), mutations use .run().

---

## O(1) Newspaper bundle (planned)

Producer: relay GET /analytics/newspaper/{date}
Consumer: jubilant-bassoon fetchNewspaper()

```
{
  date:           string     // "2026-06-21"
  generated_at:   string     // ISO timestamp
  morning_report: string     // prose, v4 voice
  truth_is: {
    type:     string          // "upset", "streak", "stat"
    headline: string
    brief:    string
  } | null
  night_stars: {
    stars:      number        // 1-5
    starScore:  number
    totalGames: number
    degraded:   boolean
  } | null
  pick: {
    game_id: string
    sport:   string
    home:    string
    away:    string
    brief:   string
  } | null
  preview:       string | null
  streak_board: {
    hot:  [{ team, sport, streak }]
    cold: [{ team, sport, streak }]
  } | null
  completed_games: [{
    id:              string
    sport:           string
    home:            string
    away:            string
    homeScore:       number
    awayScore:       number
    wentToOT:        boolean
    wasUpset:        boolean
    isSeriesClinch:  boolean
    isElimination:   boolean
    finalTimestamp:   number
  }] | null
  sport_of_week:    object | null   // Monday only
  composite_brief:  string | null   // Monday only
  contradiction:    string | null   // Monday only
}
```

Client rules:
- null sections → hide (no placeholder)
- What Changed filters completed_games against localStorage field_last_visit
- Shows in PREVIEW and LATE Circadian modes, minimized in PRIME

---

## UserDO events

Producer: jubilant-bassoon POST /user/event
Consumer: field-relay-nba UserDO

```
POST /user/event?userId={uuid}
Body: { type: string, ...payload }

Types:
  "watch"          → { gameId, sport }
  "game_pinned"    → { gameId, sport }
  "game_unpinned"  → { gameId, sport }

/user/state response includes:
  meta:            { userId, createdAt, updatedAt }
  watchHistory:    [{ gameId, sport, ts }]
  pinnedGames:     [{ gameId, sport, ts }]

/user/delete → deleteAll(), returns { ok, deleted }
```

---

## Circadian per-game state (planned)

Producer: jubilant-bassoon getCardCircadian(game)
Consumer: game card render variants

```
function getCardCircadian(game) → "PREVIEW" | "PRIME" | "NIGHT" | "LATE"

  PREVIEW: game.status === 'pre'
  PRIME:   game.status === 'in'
  NIGHT:   game.status === 'post' && minutesSinceFinal < 120
  LATE:    game.status === 'post' && minutesSinceFinal >= 120

Disclosure intent:
  PREVIEW → "anticipation" (full predictive data, no restriction)
  PRIME   → "attention"    (named states only, no composites)
  NIGHT   → "reflection"   (full data, amnesty zone)
  LATE    → "reflection"   (compressed)

shouldUnseal(game) = getDisclosureIntent(game) !== 'attention'
```

---

## Shared Odds API budget (planned)

Producer/Consumer: AmbientDO + odds-backfill.js

```
KV key: odds:daily:YYYY-MM-DD
Value:  string (integer count of credits used today)
TTL:    86400 seconds

SHARED_DAILY_CEILING = 2700
Fail-open on KV error (return true)

AmbientDO: consumeSharedOddsCredit(env, units) before each live odds fetch
Backfill:  read daily key before each sport-date fetch
```
