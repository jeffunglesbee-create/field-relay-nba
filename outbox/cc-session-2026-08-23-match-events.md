# CC session — 2026-08-23 — ESPN scoring-play grounding (ask 5)

Rule 67 session doc. Scope: ask 5 of `CC-CMD-2026-08-20-brief-data-quality` —
briefs describe games without saying what happened in them.

## HEAD progression

| commit | what |
|--------|------|
| `77eff06` | (start) scoring container shape probe |
| `8701b6b` | fix: the sport-key table's multi-word entries were never reachable |
| `644d7f6` | feat: ground briefs in ESPN scoring plays |
| `8c7b5a6` | ci: run this session's quality-chain guards at the deploy gate |
| `f9559d9` | ci: verify match_events grounding on the staged-items schedule |
| `90e6c99` | fix: check 4 selected columns the briefs table does not have |

Deploy 846 green on all 13 gate steps. Client `575e5d3` carries the
byte-identical CONTRACTS.md.

**Four guards were wired into nothing.** `banned-phrase-check`,
`cross-window-check`, `prose-style-scope-check` and `voice-register-scope-check`
were committed on 2026-08-22 and run by no workflow. All four pass, and all four
would have kept passing while the code they guard drifted. Now blocking at the
gate (`8c7b5a6`), which costs no extra CI: `deploy.yml` triggers on `src/**`,
`wrangler.toml` and `workers/**` only.

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

**STAGED (Rule 74), and automated rather than noted:** that a live recap names
someone who actually scored.

- *Blocked by:* sandbox egress 403s `*.workers.dev`, and by needing a slate to
  finalise after this deploy.
- *Unblocked by:* the next `game_recap` written in MLB/WNBA/NBA/NHL/NFL/EPL.
- *Verified by:* check 4 `recap_names_a_scoring_play` in
  `scripts/verify-staged-items.mjs`, on the existing daily 06:00 UTC
  `staged-verification` schedule. No human has to remember it.

**It is a join, not a scoring-verb grep.** The tempting version searches the
brief for "scored", "homered", "makes". That proves nothing — a season-stat
template says "scored 4.7 runs per game" and passes. So each row pulls the
actual scoring plays for its own `game_id` from ESPN, extracts the capitalised
name tokens minus the two team names, and asks whether the brief names any of
those people. A brief passes only by naming a real scorer in the game it is
about. Team names come from that same payload's
`header.competitions[0].competitors[].team`; without that exclusion "Arsenal"
appears in every Arsenal play text and every Arsenal brief, and a template would
report as grounded. A row with no exclusion set **abstains** rather than running
an unexcluded match — a wrong PASS costs more than no answer.

**Result of the first run (14, `90e6c99`, 06:18:55Z):**

```
recap_names_a_scoring_play: PENDING — no game_recap in the six sports
                            since match_events deployed
```

Correct, and it is the artifact for the plumbing rather than for the fix: seven
minutes after the deploy no recap existed, and the check said so instead of
reporting calm. Tonight's slate answers the fix itself.

**Run 13 failed first, and the failure was mine.** `D1_ERROR: no such column:
home_team` — I wrote the `briefs` column names from memory instead of reading the
schema, which is assumption class (A) in this repo's own Rule 3. Fixed in
`90e6c99` by sourcing team names from the ESPN payload the check already fetches,
which removes the D1 dependency entirely and uses the same names that appear in
the play text being matched. Checks 1-3 reported normally through the failure;
nothing regressed, the probe was broken.

## Contracts

`CONTRACTS.md` updated **byte-identically in both repos** (`contracts-identity-check`
fires from either side): the WNBA and EPL rows as a second measurement, the
running-score-as-selection-key rule with its partial-array trap, and the
`[MATCH EVENTS]` block shape including the no-scoreline rule and the truncation
line. Authority split against `[FPL MATCH EVENTS]` restated so the two sources
cannot both name the same goal.

## Carry-forwards

**One piece of ask 5's scope was NOT built and has its own command.** The soccer
`commentary` near-miss layer (off-target, woodwork, fouls — absent from
`keyEvents`, measured available on ~60% of fixtures) is not in `644d7f6`, which
ships scoring plays only. Filed as
`field-laboratory/docs/CC-CMD-2026-08-23-soccer-near-miss-enrichment.md` rather
than carried as a line here: Rule 87 makes deferred work a second CC-CMD, not a
sentence. The parent CC-CMD's status line and its three measurement-corrected
claims were updated in the same pass, because a stale status line cost this
project a full rebuild sixteen hours ago.

Two more things observed and deliberately not touched (Rule 69), recorded so they
are not lost:

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
