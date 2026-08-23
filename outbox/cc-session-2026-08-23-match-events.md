# CC session — 2026-08-23 — ESPN scoring-play grounding (ask 5)

Rule 67 session doc. Scope: ask 5 of `CC-CMD-2026-08-20-brief-data-quality` —
briefs describe games without saying what happened in them.

## HEAD progression

| commit | what |
|--------|------|
| `77eff06` | (start) scoring container shape probe |
| `8701b6b` | fix: the sport-key table's multi-word entries were never reachable |
| *(this)* | feat: ground briefs in ESPN scoring plays |

## What was built

### 1. `buildMatchEventsContext` + `formatMatchEvents` + `selectScoringPlays`

Registered as context source `match_events`, priority 4, budget 200, sports
`mlb nba wnba nhl nfl epl`. Fetches the sport's scoring container through the
relay's own `/espn-summary` proxy and emits a `[MATCH EVENTS]` prompt block.

The fetch and the formatting are separate functions on purpose: `formatMatchEvents`
is pure, so the guard script exercises what the generator actually reads without a
network round trip. Everything that decides what a brief can claim lives in the
pure half.

### 2. A fix the build uncovered — `8701b6b`

`buildESPNSummaryContext` normalized `game.sport` by stripping all whitespace and
then indexing a table keyed in **two** shapes, spaced and collapsed. Every
multi-word key in that table has been unreachable since it was written:
`'major league baseball'`, `'national football league'`, `'fifa world cup 2026'`,
`'baseball (mlb)'`, `"women's national basketball association"` and others.

A game whose sport came out of D1 as "Major League Baseball" resolved to no ESPN
slug, and the builder returned `''` — which is indistinguishable from "ESPN has no
leaders for this game yet". No error, no log line. The backfill call site
(`index.js:6627`) passes `game.sport` straight from D1 and is the path that hits it.

Found by a negative test, not by reading: a positive-only test passes identically
before and after. `scripts/sport-key-check.mjs` run against the old single-shape
lookup fails on exactly the multi-word cases (2 of 13), and that failure is the
artifact that this was a real defect rather than a tidy-up.

The table is now hoisted to module scope as `_SPORT_KEY_NORMALIZE` +
`normalizeSportKey()`, because `buildMatchEventsContext` needs the same mapping and
a second copy is how two tables that can disagree get created — the
`FPL_SHORT_NAME_MAP` case CONTRACTS.md exists for.

## What was measured, and what it changed

PRE-BUILD probe (Rule 68), `scripts/probe-scoring-containers.mjs`, through
`/espn-summary` against finalized games FIELD had briefed, event ids from
`/archive/query`'s `game_id`. Artifact:
`outbox/scoring-containers-2026-08-23T05-58-*.json`.

| sport | container | scoring items | running score on every item |
|-------|-----------|---------------|------------------------------|
| MLB | `plays` (601) | 5 | yes |
| WNBA | `plays` (410) | **112** | yes |
| NFL | `scoringPlays` | 7 | yes (no `scoreValue`) |
| EPL | `keyEvents` (20) | 3 | **no** |
| NBA / NHL | — | PENDING, out of season | — |

Three build decisions came out of the numbers rather than out of the ask:

**WNBA is the volume case, and it is in season.** The ask's own summary flags NBA
at 119 items as the sport needing selection rather than enumeration. WNBA measured
112 on a real game. The selection rule is therefore exercised by live data today
instead of from October, and "NBA needs selection" was wrong by one sport.

**`soccer/eng.1` works through `/espn-summary`.** `_ESPN_SPORT_SLUG` maps every
soccer key to `fifa.world` — the World Cup, wrong for a domestic league. `eng.1` is
verified; the other domestic slugs are NOT, and are deliberately absent from
`_EVENT_SLUG` so an unlisted competition returns `''` rather than fetching a
plausible-looking URL.

**Budget 200, not the 350 first written.** The worst realistic block — 8 plays of
ESPN basketball prose after selection, plus header and truncation note — measures
674 chars / 169 tokens. At 350 the assembler's own 1.5x per-source ceiling would be
525 of a 600-token per-game budget, which is a ceiling that cannot catch anything.

## Verification

**VERIFIED here (pure, no network):** `scripts/match-events-check.mjs`, 25
assertions, blocking at the deploy gate. `scripts/sport-key-check.mjs`, 13
assertions, blocking. Both pass 100%.

The negative tests are the ones that carry weight, because a selection rule that
returns everything passes every positive assertion:

- `n=13` must NOT enumerate (off-by-one on the threshold is invisible otherwise)
- 112 items must yield a **strict subset** — a rule that degrades to "return
  items" blows the budget, and an over-budget block is SKIPPED by the assembler,
  so the failure presents as a brief with no events rather than a long one
- partial running score → chronological tail, not a `NaN` ranking that silently
  finds no lead changes anywhere
- missing running score (the live EPL path) must not throw
- the block must never print a scoreline
- the truncation note must be absent when nothing was truncated
- `'soccer'` must NOT normalize to `'epl'` — `eng.1` is England's slug and would
  attach one competition's events to another's game
- `"Basketball"` + league `"WNBA"` must reach `wnba`, not the NBA slug

**STAGED (Rule 74):** that a live WNBA or EPL recap now names scoring plays.
- *Blocked by:* sandbox egress 403s `*.workers.dev`, and by needing one
  journalism cycle after this deploy.
- *Unblocked by:* the next `*/15` cron tick following the deploy of this commit.
- *Verify:*
  ```bash
  curl -s "$RELAY/archive/query?sport=WNBA&brief_type=game_recap&limit=3" \
    | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
      for (const r of d.results||[]) {
        const named = /(makes|scores|Goal|Yd Run|homer)/i.test(r.brief_text||"");
        console.log(r.game_id, "names a scoring play:", named);
      }'
  ```
  Pass condition: at least one row prints `true`. A row printing `false` for every
  recap on a slate that had games means the block is not reaching the prompt —
  check the assembler's budget skip first, not ESPN.

## Contracts

`CONTRACTS.md` updated **byte-identically in both repos** (`contracts-identity-check`
fires from either side): the WNBA and EPL rows as a second measurement, the
running-score-as-selection-key rule with its partial-array trap, and the
`[MATCH EVENTS]` block shape including the no-scoreline rule and the truncation
line. Authority split against `[FPL MATCH EVENTS]` restated so the two sources
cannot both name the same goal.

## Carry-forwards

None deferred from this scope. Two things observed and deliberately not touched
(Rule 69), recorded so they are not lost:

1. **A third sport-key table exists.** `_CONTEXT_LEAGUE_TO_SPORT`
   (`src/index.js` ~8452) maps league labels to the same sport keys
   `_SPORT_KEY_NORMALIZE` produces, in the other file. It is currently correct and
   consistent, which is exactly when a table is cheapest to consolidate. Its own
   commit.
2. **NBA and NHL containers are PENDING**, not assumed. Both are out of season in
   August and were not re-measured on 2026-08-23; their rows in CONTRACTS.md stand
   on the 2026-08-21 scoreboard probe. Re-probe when the seasons open — the
   registry already lists them, so a wrong container would present as a silently
   missing block.
