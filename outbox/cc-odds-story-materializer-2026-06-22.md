# Odds Story Materializer — 2026-06-22

## What shipped

- `src/odds-story.js` — `computeOddsStory(opening, closing)`. Pure-arith
  one-liner emitter. Null-guards every nested field so FanDuel rows
  (no `spread`) don't crash.
- `src/context-assembler.js` — `buildOddsStoryContext(env, game)` looks
  up today's archive row by resolved team keys (same matcher as
  `snapshotCronOdds` at index.js:4001), then materializes the story.
  Registered as `odds_story` priority 5, 100-token budget, applies to
  MLB / NBA / NHL / NFL / WNBA + EPL / MLS / WC26 / LaLiga / SerieA /
  Bundesliga / Ligue1.
- `src/index.js` — `GET /odds-story/preview?date=YYYY-MM-DD` probe
  endpoint. Reports per-game opening/closing presence + materialized
  story + counts. `/odds-story` added to MCP probe_relay_route allow-list.

## Commit & deploy

- `2350242` feat: odds story materializer — pre-computed line movement
  narratives for journalism context
- Deploy: workflow 27992087027 — completed/success.

## ADR-002 / RUWT status

CLEAN. Pure arithmetic on published betting lines, same category as
reporting a stock price change. No drama scoring, no interest level,
no named binary conditions (RUWT US 9,421,446 B2). The Context
Assembler delivers facts; the LLM does editorial work.

## Pre-build facts verified

- 106 games with `opening_odds`, 98 with `closing_odds` in archive.
- Odds JSON shape per ARCHIVE_DB probe:
  `{source, captured_at, moneyline:{home,away}, total:{over,under}, spread?:{home,away}}`
- `spread` present on DraftKings, absent on FanDuel — null guard
  required and now enforced.
- Opening and closing may come from different sources (e.g. DK open,
  FD close); movement computation tolerates the mix.
- `CONTEXT_SOURCES` lives at context-assembler.js line 332; `odds_story`
  is now the first entry (priority 5, runs before sport stats).

## Unit probe (computeOddsStory)

```
A FanDuel close (no spread):
  [ODDS STORY] ML moved 30 pts favorite-ward (opened -150, closed -180).
  Total moved 1.5 (opened 8.5, closed 7) — under pressure.

B null opening: ""
C JSON-string inputs: same as A
D no movement: ""
```

## E2E probe (`/odds-story/preview?date=2026-06-08`)

```
status: 200
total: 5  withStory: 4  withoutStory: 1  missingClosing: 0  missingOpening: 0
```

| Game                                  | Materialized story                                                                                  |
|---------------------------------------|------------------------------------------------------------------------------------------------------|
| BAL vs SEA (MLB)                      | Total moved 2.5 (opened 9, closed 6.5) — under pressure.                                             |
| TB  vs BOS (MLB)                      | ML moved 37 pts favorite-ward (opened -102, closed -139). Total moved 2.5 (opened 8, closed 5.5) — under pressure. |
| CLE vs NYY (MLB)                      | Total moved 3.0 (opened 7.5, closed 10.5) — over pressure.                                           |
| CON vs NYL (WNBA)                     | ML moved 175 pts favorite-ward (opened +575, closed +400). Total moved 5.0 (opened 162.5, closed 157.5) — under pressure. |
| IND vs WAS (WNBA)                     | (no significant movement — withoutStory)                                                             |

Real movement, correctly labeled by direction. Mixed-source pairs
(DK/FD) materialize cleanly because the matcher operates on the parsed
moneyline/total fields, not the source string.

## Integration status

- **VERIFIED:** computation correctness (unit probes), endpoint shape,
  end-to-end materialization against real archive rows.
- **STAGED:** journalism cron consumption. The Context Assembler will
  pick up `odds_story` on the next 15-min `handleJournalismCycle` tick.
  No code path changed in the cron itself — `buildOddsStoryContext` is
  invoked by the existing `assembleContext` iterator, returns `''`
  when no archive row matches, so the cron is fail-independent.
- **UNTESTED:** prose output quality with the new context block.
  Recommend reviewing one journalism brief after the next cron tick
  for a game that has both opening and closing odds.

## Carry-forwards

1. **Closing odds sparseness.** Only games that have already gone
   through the Game State Transition Hook will have `closing_odds`.
   The preview probe lets you see coverage per date — use it to
   forecast which days will surface stories.
2. **Single-game cron alignment.** `buildOddsStoryContext` queries by
   `date = today` (UTC). If `handleJournalismCycle` runs for a game
   whose archive `date` already advanced to tomorrow (rare overnight
   edge), the lookup misses. Acceptable per probe-only signal but
   noted.
3. **Threshold tuning.** Current significance: ML 10 pts, spread 0.5,
   total 0.5. These come straight from spec. If too noisy/quiet,
   adjust constants in `computeOddsStory` and bump the version note
   in `outbox/cc-odds-story-materializer-{date}.md`.
4. **No alerts.** Per scope boundary, the materializer is data-only.
   No push, no toast, no drama scoring. Future work could plumb a
   weekly summary into the analytics cron if desired.

## Verify commands

```
# From an MCP-connected chat client:
probe_relay_route /odds-story/preview?date=2026-06-08

# Anonymous:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/odds-story/preview?date=2026-06-08'

# Today:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/odds-story/preview'
```
