# CONTRACTS.md — Cross-System Data Contracts

> **This file must be identical in jubilant-bassoon AND field-relay-nba.**
> If you update one, update the other. Both CC sessions read their own
> repo's copy. A mismatch causes silent failures at system boundaries.

Last synced: 2026-08-21 (team identity + FPL source authority — relay + client copies)

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
  sport_of_week:    object | null   // Monday only — {winner, dramaTotal, gamesPlayed, runnerUp, runnerUpDrama, summary, allSports}
  composite_brief:  string | null   // Monday only — AI prose blending best briefs across sports
  contradiction:    string | null   // Monday only — one-sentence acknowledgment of weekly narrative flip (null if none)
  broken_record:    object | null   // Monday only — {records: [{team, phrase, occurrences, dates}], lookback_days: 14}
}
```

Client rules:
- null sections → hide (no placeholder)
- What Changed filters completed_games against localStorage field_last_visit
- Shows in PREVIEW and LATE Circadian modes, minimized in PRIME

---

## drama_arc (D1 column + POST /archive/drama-arc)

Producer: jubilant-bassoon (client computes via buildDramaArc / live drama tracker)
Consumer: relay POST /archive/drama-arc → stores in regular_season_games.drama_arc (TEXT/JSON)
Read back via: GET /archive/game → game.drama_arc_parsed (parsed object)

```
{
  peak:             number        // 0-100 peak drama score
  peakPeriod:       number        // period number when peak occurred
  peakMinute:       number | null // minutes into game (future use)
  sustainedMinutes: number        // minutes spent above drama threshold
  trend:            "escalating" | "declining" | "steady"
  classification:   string        // from _dramaArcClassify() — e.g. "blowout", "nailbiter"
  samples:          [{s: number, p: number}]  // up to 10 downsampled (score, period) pairs
}
```

POST body: `{ source_id: string, drama_peak: number, drama_arc: object | string }`
- drama_arc accepted as JSON object or JSON string
- Relay normalizes to string before D1 write
- Relay reads back and parses to drama_arc_parsed in /archive/game response

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

---

## Rule 87 — CC-CMDs must be self-completing (SELF-COMPLETE-A)

Every CC-CMD must be self-completing. Follow-ups, post-deploy verifications,
and carry-forwards are spec failures — they mean the done condition was not
defined upfront or tasks were intentionally deferred.

**Required in every CC-CMD:**

1. **Probe block first.** Read every constant, URL, function name, and line
   reference from current HEAD before writing any code. Never write from
   memory — probe it. The probe block populates the spec.

2. **Explicit done condition.** Define what done looks like as a verifiable
   probe output: a specific endpoint returning a specific value, a D1 count
   reaching zero, a smoke assertion passing. "Deploy succeeded" is not a
   done condition.

3. **Execution inside the session.** If the task requires running something
   after deploy (backfill loop, verification curl, D1 query), that execution
   is a numbered task in this CC-CMD — not a carry-forward.

4. **No deferred work without a second CC-CMD.** If work is genuinely out of
   scope, write a second CC-CMD before closing the first. "Worth a separate
   session" is a carry-forward and a spec failure.

5. **Outbox manifest is the last task.** Covers: commit hash, deploy run ID,
   done-condition probe output, any genuine residual (proxy failures only —
   not deferred work).

**Violation signals:** carry-forwards without a second CC-CMD written;
verification steps blocked by sandbox egress (use relay self-probe endpoints
instead); URLs or function names written from memory rather than probed.

---

## Rule 88 — Correct route, fast execution (CORRECT-FAST-A)

Don't take the fast route. Take the correct route and do it fast.

"Fast" means minimize time to correct completion — not time to first attempt.
A correct approach executed in 5 minutes is faster than a shortcut that
requires 3 iterations. If the correct approach isn't obvious, probe more —
not guess faster. Uncertainty is not permission to shortcut.

**The test before executing:** "Is this the right way, or the quick way?"
If quick way — stop, find the right way, then move at pace.

See STANDARDS.md Rule 88 for full rationale and case study.

---

## /soccer/xg (relay route)

Producer: field-relay-nba `/soccer/xg` route (src/index.js)
Consumer: context-assembler.js `buildSoccerXGContext` (relay-internal);
relay's own `handleV2Games` second-leg enrichment (round-label CC-CMD,
SHIPPED 2026-06-30 — relay commit 5911f0b5, verified live)

```
GET /soccer/xg?league={espnLeagueSlug}&event={espnEventId}

{
  event:           string
  league:          string
  _hasXG:          boolean   // true only for leagues ESPN provides xG for (not MLS)
  _hasMatchStats:  boolean   // added 2026-06-30 — possession/shots/passes/cards,
                              // present even when _hasXG is false
  _series:         {         // added 2026-06-30 (round-label CC-CMD, SHIPPED) —
                              // null unless ESPN's /summary returns series data
                              // (two-legged ties only)
    title: string|null, leg: number|null, totalLegs: number|null,
    completed: boolean|null, homeAggregate: number|null,
    awayAggregate: number|null, otherLegEventId: string|null
  } | null,
  _source:         "espn-core"
  home: { id, name, abbr, expectedGoals?, possessionPct?, totalShots?,
          shotsOnTarget?, totalPasses?, passPct?, totalTackles?,
          interceptions?, foulsCommitted?, yellowCards?, redCards?,
          totalCrosses?, wonCorners? }
  away: { ...same shape as home }
}
```

Note: `_series`/`aggregateScore` is ESPN-native and only covers
ESPN-sourced soccer. Stats-api-sourced tournaments (e.g. TELUS Canadian
Championship, via the tournament multiplexer) have NO equivalent field —
two-legged ties there are two independent `postseason_games` rows with no
linking aggregate. Do not assume this contract covers that source.

---

## /soccer/season-form (relay route)

Producer: field-relay-nba `/soccer/season-form` route (src/index.js)
Consumer: context-assembler.js `buildSoccerSeasonFormContext`

```
GET /soccer/season-form?team_id={MLS-CLU-xxxxxx}&competition_id=&season_id=

{
  _hasForm: boolean
  _source:  "mls-stats-api"
  team_id, team_name, matches_played: number
  xG: number, xG_efficiency: number, goals: number, clean_sheets: number
  possession_ratio: number, shots_conversion_rate: number,
  passes_conversion_rate: number
}
```

Season-to-date aggregate, distinct grain from `/soccer/xg` (per-match).
KNOWN GAP: `buildSoccerSeasonFormContext` needs `game.mlsHomeTeamId`/
`mlsAwayTeamId` (stats-api `MLS-CLU-xxxxxx` format — NOT the same id space
as ESPN's numeric competitor ids) on the game object to ever call this.
Nothing populates those fields yet — context builder returns `''` for
every game until identity-resolver gains a name→MLS-CLU-xxxxxx mapping.
Separate CC-CMD needed, not yet written.

---

## game.round (client-facing, all sports)

Producer: multiple — `adaptESPNWCSoccer` (ESPN `comp.notes[0].headline`,
round-label CC-CMD, SHIPPED 2026-06-30 — relay commit 5911f0b5), tournament
multiplexer (stats-api `section_name`/`match_type`, written directly to
`postseason_games.round`, SHIPPED), pre-existing NBA/NHL/UFL postseason
data (already populated before this session, format: "East CF" etc.)
Consumer: jubilant-bassoon round badge — `buildRoundBadge(game)`,
index.html:7716. SHIPPED 2026-06-30, commit 989f098. Renders `.round-badge`
span for any non-empty `game.round`, plus an "Agg: X-Y" line when
`game.series.homeAggregate`/`awayAggregate` are present and `series.leg
!== 1`. Single function, all sports, no branching. Data pipeline:
`mapV2ToESPN` maps round/series onto game objects; `fetchV2AllScores`
triggers a re-render only when round data is newly arrived (not on every
poll). Verified: 809/0 smoke (A-ROUND-1/2), full CI green including
Playwright browser runtime tests.

Verified live 2026-06-30 against real UCL Round of 16 second legs:
```
round:  "2nd Leg - Arsenal advance 3-1 on aggregate"
series: { title: "Round of 16", leg: 2, totalLegs: 2, completed: true,
          homeAggregate: 3, awayAggregate: 1, otherLegEventId: "401862578" }
```
Confirmed across 7 real ties (Arsenal, Sporting CP, PSG, Real Madrid,
Barcelona, Bayern Munich, Liverpool, Atlético Madrid). N+1 avoidance
confirmed empirically: a same-day EPL slate (10 games, no leg notes)
triggered zero extra `/soccer/xg` fetches.

```
game.round: string   // human-readable, vocabulary varies by source:
                      //   NBA/NHL: "East CF", "Stanley Cup Final"
                      //   UFL: "Playoff Eliminator"
                      //   MLS tournaments: "Quarterfinal", "Round of 16"
                      //   ESPN live soccer: "1st Leg", "2nd Leg"
```

Deliberately not normalized across sources — rendered as-is. A unified
taxonomy would be a future data-layer decision, not assumed needed.

## BSD endgame-capture R2 key format (FIELD_DATA bucket)

Producer: `runBSDEndgameCapture` (WC26) and `runBSDClubLeagueEndgameCapture`
(all other BSD-covered leagues), both `src/index.js`, relay commit TBD —
CC-CMD-2026-07-14-bsd-endgame-capture-generalize. Fired from `scheduled()`
on every cron tick; captures momentum/stats/incidents/average-positions for
any live game crossing the 80-120 minute window.

```
R2 key: bsd/{slug}/{bsdEventId}/{momentum,stats,incidents,average-positions}.json
  slug = 'wc26' for World Cup games (unchanged, pre-existing format)
       = one of epl, mls, ucl, europa, eflchamp, laliga, seriea, bundesliga,
         ligue1 for club leagues (new, this CC-CMD) — derived from BSD's own
         league_id via BSD_LEAGUE_ID_TO_SLUG, itself derived from V2_LEAGUES
         so the two tables can't drift apart. europa/conference share BSD
         league_id 8 (BSD doesn't distinguish the two competitions) — both
         write under 'europa'; this is a disclosed, accepted ambiguity.
```

**RESOLVED (2026-08-13) — the open question below is now answered.** The
2026-07-15 note could not distinguish "the route does not exist" from "it is
a live-only feed that stops serving after full time", because every test to
that point used a finished event. Measured across 6 events via
`scripts/bsd-avgpos-diagnose.mjs`
(`outbox/bsd-avgpos-diagnose-2026-08-13T*.log`):

| event | status | `/average-positions/` | `/stats/`.average_positions |
|---|---|---|---|
| 207955 | **2nd_half (LIVE)** | 404 | `{}` (empty) |
| 223324 | finished | 404 | `{away, home}` |
| 207987 | finished | 404 | `{away, home}` |
| 207962 | finished | 404 | `{away, home}` |
| 207956 | finished | 404 | `{away, home}` |
| 587659 | finished | 404 | `{}` (empty) |

All six returned the byte-identical body
`{"error": true, "status": 404, "detail": "Not found"}`. **A live match 404s
exactly like a finished one, so the live-only theory is falsified** — the
dedicated endpoint never serves. ("Not found" rather than a subscription
error also argues against a plan gate, but that is inference, not proof.)

The same run confirms the other half: `/stats/`'s embedded
`average_positions` is populated **post-final only** — the live event's was
`{}`. So during play the data does not exist in *either* source, which the
prior note correctly suspected but could not show.

Consequences:
- `GET /bsd/events/{id}/average-positions` (relay) now serves
  `parsed.average_positions` from `/stats/`, same shape as the R2 object.
  Returns `{}` during play, `{away, home}` after final, 404 only when the
  key is absent entirely.
- `_bsdCaptureStatsWithAvgPositions`'s dead level-1 call was **removed**
  (commit `1e6b449`), so `/stats/` is the only source rather than a
  fallback, and `customMetadata.source` is now `stats-embedded` (was
  `stats-fallback` — that name described a fallback that no longer exists).
  Covers both `runBSDEndgameCapture` (WC26) and
  `runBSDClubLeagueEndgameCapture`, which share the helper.
- The capture now refuses to write an EMPTY `average_positions` (commit
  `1f08656`). `{}` is truthy and is what a match in progress returns, and
  this cron fires across an 80-120 minute window — mostly pre-final — so the
  unguarded write would overwrite populated positions with nothing. Same
  failure class as `src/mlb-savant-r2.js` `7588b24` the same day.
  **Not yet observed firing:** verify on the next club match crossing the
  window via `GET /bsd/r2/read?key=bsd/{slug}/{id}/average-positions.json`
  — pass is a populated `{away, home}` with source `stats-embedded`.

**BSD source-endpoint note, revised (2026-07-15) — superseded by the above,
retained for provenance:** `/api/v2/events/{id}/average-positions/`
404s when tested against a finished event — but that's consistent with two
different explanations that weren't distinguished by testing against a
weeks-old finished game: either the route doesn't exist, or it's a
live-only real-time feed that stops serving once the match ends. Two
independent historical codex entries (`bsd-endgame-cron-validation-june26`,
`cf/2026-07-02/soccer-crosscheck-first-run-bugs`) both hit the identical
404 against non-live events, and the first explicitly labels its own
confirmation that `/stats/`'s embedded `average_positions` field is
populated as "post-final" — not confirmed present during live play, which
is when this cron's 80-120 min window actually fires. Neither source is
safely known-good for the live window alone. `runBSDClubLeagueEndgameCapture`
tries the dedicated endpoint first, falls back to the `/stats/`-embedded
field only if that fails (2-level fallback, Rule 76) — genuine live-endpoint
behavior remains unverified since no club match was live during this
investigation. `runBSDEndgameCapture` (WC26) is unchanged — out of that
dispatch's scope; see `docs/CC-CMD-2026-07-15-bsd-wc26-avgpos-fix.md`
(updated to recommend the same fallback, not a straight swap).

Consumer: **none yet.** jubilant-bassoon's post-game pitch replay ("site 3",
`index.html` ~L42601) still reads the pre-existing hardcoded
`bsd/wc26/${_bsBsdEventId}/stats.json` key only — confirmed untouched as of
its own CC-CMD-2026-07-14-bsd-pitch-generalize (`docs/outbox/cc-bsd-pitch-
generalize-2026-07-14.md`, scored 100/100), which explicitly scoped site 3
out. This entry documents the convention a future client-side fix to site 3
must match — `bsd/{slug}/{bsdEventId}/stats.json` — so that fix doesn't have
to independently reverse-engineer or guess the relay's real key shape.

## FieldGame home/away curatedRank (NFL/CFB, ESPN adapter)

Producer: `adaptESPNFootball(ev, sport)`, `src/index.js` ~L1249 —
CC-CMD-2026-07-15-cfb-curatedrank-relay. `home`/`away` objects now carry
`curatedRank: number | null`, sourced from ESPN's raw competitor field
`curatedRank.current` (flattened, matching the existing `score` convention).

```
FieldGame.home.curatedRank / FieldGame.away.curatedRank: number | null
  1-25 for ranked teams, 99 for unranked (ESPN's own convention) — confirmed
  live 2026-07-15 against a real ESPN CFB scoreboard fetch (Ohio State
  Buckeyes curatedRank.current: 1, UCLA Bruins: 99). null only if ESPN omits
  the field entirely (not observed within FBS scope — groups=80 always
  returns at least {current: 99} for unranked FBS teams; the null fallback
  is a defensive guard, not a case seen in real data).
  NFL/CFB (+ future CBB, unconfirmed) only — not added to adaptESPNMLB or
  other sport adapters, since ESPN's curatedRank convention is specific to
  American football / basketball ranking polls.
```

Consumer: jubilant-bassoon's `isFeaturedTierGame` (rank ≤25 signal), which
reads `g.homeCuratedRank`/`g.awayCuratedRank` on the client's schedule
objects — a *different* field name/location than `FieldGame.home.curatedRank`
above. This relay change alone does not thread the value all the way to the
client grid: a separate client-side pipeline (CFB section-injection,
`docs/CC-CMD-2026-07-15-cfb-section-injection.md`, jubilant-bassoon) still
needs to map `fg.home.curatedRank` → `g.homeCuratedRank` on schedule
objects. Until that lands, the client's existing `?? 99` defensive read
means the rank signal safely never fires (no crash, no invented data) —
consistent with how this repo's other "producer ships, consumer pending"
entries above are handled.

---

## GET /journalism/game/{eventId} — per-game brief lookup

Producer: `src/index.js` ~L12906 route handler; backing KV key written by
the `JOURNALISM_QUEUE` consumer's `game-brief` branch (`src/index.js`,
`async queue()`) and by `enqueueNHLBriefs`/`enqueueNBABriefs`'s own
pre-enqueue dedup checks (`src/index.js` ~L3758/~L3879).
Consumer: jubilant-bassoon `scripts/night-owl-email.js`'s `fetchRelayBrief()`
— confirmed via direct source read (`mcp__FIELD_Handoff__read_source`,
2026-07-15), not assumed.

```
GET /journalism/game/{eventId} → { brief: string | null }
  eventId MUST be the bare, unprefixed ESPN numeric event id (e.g. "760424",
  not "espn:760424" / "nhl:760424" / "nba:760424"). Confirmed live 2026-07-15
  against the real client call site:
    fetch(`https://field-relay-nba.jeffunglesbee.workers.dev/journalism/game/${espnEventId}`)
  where espnEventId is a raw ESPN scoreboard event id, never sport-prefixed.
  Route strips non [a-zA-Z0-9_:-] characters from the path segment and does
  a direct KV get on `brief:game:{eventId}` — no normalization, no fallback
  lookup across shapes. {brief: null} on any miss (never an error status).
```

**Write-side id shape — CC-CMD-2026-07-15-brief-game-kv-id-convention (fixed
2026-07-15):** every real writer of the backing `brief:game:{id}` KV key
strips its own internal sport-tag prefix (`espn:`/`nhl:`/`nba:`) before
building the key, via `stripKVIdPrefix()` (`src/index.js`, defined next to
`canonicalizeWC26Sport`) — applied only at the KV-key-construction point;
`job.eventId` / `g.id` / the `briefs.game_id` D1 column keep their original
prefixed values everywhere else. Before this fix, WC26/NHL/NBA game briefs
were silently unreachable via this route (real briefs existed in KV, but
under a prefixed key the client's bare-id request never matched) — MLB/WNBA/
other sports flowing through `handleJournalismCycle`'s generic per-league
loop already used bare ids and were unaffected.

**Known gap, deliberately not fixed in this pass:** Golf's KV key
(`golf_{eventId}_R{roundNum}`, `src/index.js` ~L6927) is not a
`{prefix}:{id}` shape `stripKVIdPrefix()` recognizes, and its round suffix
is functionally load-bearing (distinguishes R1–R4 recaps for the same
event) — collapsing it to match the client's round-agnostic bare-id request
needs its own dedicated look, not a rushed change under this dispatch.
`/journalism/game-complete`'s GameDO-sourced `gameId` (`src/game-do.js`,
set from a client-supplied WebSocket query param) was also left unverified
— not confirmed against real client code in this session.


---

## ESPN per-sport event source (summary endpoint)

Producer: ESPN `site.web.api.espn.com/apis/site/v2/sports/{path}/summary?event={id}`
Consumer: relay recap/brief generation (ask 5, CC-CMD-2026-08-20-brief-data-quality)

**There is no single container. Each sport puts scoring events somewhere
different, and the three probed independently disagreed.** Verified 2026-08-21
against real finalized events (Rule 73 context: one completed event per sport;
NBA/NHL ids came from the ESPN scoreboard for 2026-01-15 because both are out of
season in D1 in August).

| sport | ESPN path | container | filter | prose field |
|-------|-----------|-----------|--------|-------------|
| soccer | `soccer/{league-slug}` | `keyEvents` | `scoringPlay === true` | `text` |
| MLB | `baseball/mlb` | `plays` | `scoringPlay === true` | `text` |
| NBA | `basketball/nba` | `plays` | `scoringPlay === true` | `text` |
| NHL | `hockey/nhl` | `plays` | `scoringPlay === true` | `text` |
| NFL | `football/nfl` | `scoringPlays` | *(all items are scoring)* | `text` |

`keyEvents` is ABSENT for MLB, NBA, NHL and NFL. `plays` is ABSENT for soccer and
NFL. `commentary` exists for soccer only. **Do not read a container without
checking the sport** — every one of these absences was measured, not assumed.

Verbatim samples, one per sport:

```
soccer  "Goal! Shamrock Rovers 1, KuPS 0. Enda Stevens (Shamrock Rovers) right
         footed shot from the centre of the box to the centre of the goal."
MLB     "Walker homered to center (407 feet), Wetherholt scored and Herrera scored."
NBA     "Paolo Banchero makes driving layup (Anthony Black assists)"
NHL     "Cole Caufield Goal (22) Wrist Shot, assists: Noah Dobson (21)"
NFL     "Woody Marks 20 Yd Run (Ka'imi Fairbairn Kick)"
```

### Read `text`, not the structured participant fields

Soccer `participants[]` entries are `{athlete:{id,displayName}}` with **no role
field**; role is positional (`[0]` scorer, `[1]` assister). Measured across 18
goals: the assister is structurally present on only 8 of 14 assisted goals, while
`text` carried it 14/14. NBA and NHL `text` likewise names assists inline.
Structured names also disagree with the prose ("Dali" vs "Dalisson De Almeida").

Use `participants[0].athlete.id` for stable joins. Not as a prose source.

### Scoring-item volume differs by an order of magnitude

Per completed event: NFL 8, NHL 8, soccer 2–4, MLB 11, **NBA 119** (every made
basket is a scoring play). A generator that concatenates scoring items will
produce a usable paragraph for four sports and an unusable wall for basketball —
NBA needs selection, not enumeration.

### Cost

One summary fetch per game **at finalization**, not per cron tick: ~28 calls/day
against a 14-day mean of 28 games/day. Per-tick would be 2,688 calls / 790 MB.
Payload sizes measured: MLB 1,082 KB, soccer 301 KB. Rule 78 applies — replicate
the existing `cacheEverything` + TTL pattern.

### Soccer near-miss enrichment — ADOPTED

`commentary` carries `Shot Off Target`, `Shot Hit Woodwork` and `Foul` events
that `keyEvents` does not contain at all. Availability measured over 20 fixtures:
**12 rich-tier (98–129 commentary items, 5–16 near-misses), 8 sparse-tier (18–29
items, 0 near-misses)** — a clean bimodal split with nothing in between, so
`commentary.length >= 60` identifies a rich fixture before parsing.

Enrichment therefore fires on ~60% of soccer fixtures. Recaps use near-miss items
where present and degrade to goals-only where not. The same tier governs whether
`participants[1]` is populated (sparse: 0/6 assists structured; rich: 8/8).

`keyEvents` and `commentary` **overlap; neither is a superset** — verified by
per-item id join across 6 fixtures. `keyEvents` uniquely holds substitutions and
period markers; `commentary` uniquely holds near-misses. All goal items appear in
both (0 missing across 6 fixtures), so the goal read path is unaffected.

---

## Team identity — one resolver, one table (relay-owned)

Producer/owner: `field-relay-nba/src/identity-resolver.js` (`resolveTeamKey`)
Consumers: the odds join, the FPL→game join, every archive match

**There is exactly one club-alias table, and it lives in the relay.** Any join
that matches a club name from one source against a club name from another
resolves BOTH sides through `resolveTeamKey` and compares the returned keys.

### Why this is a contract and not a style note

A missing alias is a **miss** — the column stays NULL, which is merely
unhelpful. A collision is a **corruption**: the odds join keys on
`resolveTeamKey(home) + '|' + resolveTeamKey(away)`, so two clubs sharing a key
attach one club's line to another club's game, silently, and it looks entirely
plausible on the card. Two independent alias tables can drift into exactly that.

Guarded by `scripts/check-team-identity-collisions.mjs` (deploy-gating): 35 alias
pairs must resolve together, and no two distinct clubs may share a key.
Negative-tested by club name.

**Never normalise by token-stripping.** Spanish naming is the case that proves
it: unqualified *"Real"* means **Real Madrid**, while **Real Sociedad**'s short
form is *"Sociedad"* — the "Real" is dropped. A strip-leading-"Real" rule points
the wrong way in two directions at once, and Real Betis v Real Sociedad was a
real fixture on 2026-08-21. Per-club entries only.

### `FPL_SHORT_NAME_MAP` is superseded

`jubilant-bassoon/src/legacy/field.js:19195` carries a 12-entry FPL club-alias
map. Measured 2026-08-21, entry by entry: **11 of the 12 already resolved through
`resolveTeamKey`; `Spurs` was the only gap**, now added. The relay resolver is a
strict superset.

So the FPL→game join uses `resolveTeamKey`, **not** a second table. Any FPL
spelling found missing is added to `identity-resolver.js`, where the collision
guard covers it — never to a parallel map. The client map is retained only until
its call sites are repointed; it must not gain new entries.

### Source authority for shared FPL/ESPN fields

FPL `event/{gw}/live/` and ESPN `keyEvents` both carry goals and assists. To stop
two feeds disagreeing inside one brief:

| field | authoritative source |
|-------|---------------------|
| goals, assists, match narrative | **ESPN** (`keyEvents`, per the per-sport table above) |
| bonus points, saves, FPL-native stats | **FPL** (`event/{gw}/live/`) |
| cards, minutes | FPL (finer-grained), falling back to ESPN prose |

ESPN owns the match story; FPL adds the fantasy layer ESPN does not carry. A
brief must never name the same goal from both.
