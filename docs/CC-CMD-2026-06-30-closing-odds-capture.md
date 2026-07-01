# Claude Code Command — Closing Odds Capture (completes Odds Story Materializer)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-closing-odds-capture-2026-06-30.md.

## CONTEXT

`computeOddsStory()` (src/odds-story.js) and its context-assembler wiring
have been live since June 22 (commit 23502425d) but have never produced a
single real story. Verified live via `/odds-story/preview` across three
sampled dates (6/23, 6/29, 6/30) — every game on every date shows
`hasClosing:false`, `withStory:0`.

ROOT CAUSE: no code path in the relay ever writes `closing_odds`.
`opening_odds` has a real write path — `snapshotCronOdds()` (index.js
~4443-4520), using `fetchSportOddsLive()` + `extractOddsForGame()` +
`reconcile()`. `closing_odds` has zero write call sites anywhere in src/ —
only reads (context-assembler.js, the /odds-story/preview diagnostic, and
one unrelated hardcoded manual injection for a single game on June 25).

The finalization write point already exists: `/archive/game` (index.js
~7712), called from the catch-up loop (index.js ~5630-5650) whenever
`gm.isFinal === true`. It currently writes home_score/away_score/venue/etc
via `ON CONFLICT ... DO UPDATE SET ... COALESCE(...)` but never touches
odds.

IMPORTANT FRAMING: "closing odds" means the last line **before kickoff**,
not odds at game-end (which don't meaningfully exist post-game). The relay
already has `fetchSportOddsHistorical(env, sportKey, isoDate)` (index.js,
near the live-odds functions) which charges 10x quota per the existing
comment ("~30 credits per call, 3 markets") and fetches odds pinned to a
specific historical ISO timestamp. That is the correct mechanism here: at
game-final time, fetch historical odds pinned to the game's actual kickoff
timestamp — not a "live" fetch, which would be post-game and meaningless.

## PRIOR ART — DO NOT TOUCH

The AVV Odds API adapter proof (2026-06-29/30 session) needed real D1 data
to build a fixture (`docs/adapter-fixtures-odds-story-wnba.json` in
jubilant-bassoon) and manually backfilled `closing_odds` for exactly one
game via a direct D1 write:

```
game_id: wnba_2026-06-28_goldenstat_newyorklib
change_log source: "odds_backfill"  (ts 2026-06-29 14:12:31)
```

This label does NOT correspond to any function or route in committed
source — grepped, confirmed absent. It was a one-off manual UPDATE, not a
pipeline. The AVV proof itself is legitimate and does not need to be
touched: it proves `computeOddsStory()` + context-assembler injection
produce correct output *given* real opening+closing odds. It does not
prove — and was never meant to prove — that closing odds get captured for
any other game. Live data confirms this: of 18 other games on 2026-06-28
with `opening_odds` present, zero have `closing_odds`. Same pattern across
every other date sampled (6/23, 6/29, 6/30) — this one row is the only
non-null `closing_odds` in the entire archive.

Task 3's "skip if row already has closing_odds" guard will naturally leave
this row alone — no special-casing needed, just don't be surprised by it
during verification (it will already show `hasClosing:true` before this
CC-CMD's changes are even deployed; that is expected and is not evidence
the new capture path is working).

## PRE-BUILD PROBE (read every symbol below from HEAD before writing anything — Rule 87)

```bash
grep -n "async function fetchSportOddsHistorical" src/index.js
grep -n "async function fetchSportOddsLive" src/index.js
grep -n "function extractOddsForGame" src/index.js
grep -n "async function reconcile" src/index.js
grep -n "ODDS_QUOTA_FLOOR\|consumeOddsCredit" src/index.js
grep -n "function archiveSportToOddsKey" src/index.js
grep -n "function resolveTeamKey" src/index.js
grep -n "pathname === '/archive/game'" src/index.js
grep -n "gm.isFinal" src/index.js
grep -n "comp?.date\|competitions?.\[0\]?.date\|comp?.status?.type" src/index.js
```

Confirm before proceeding:
1. `fetchSportOddsHistorical`'s exact signature and return shape — verify
   it matches the `{games, quotaRemaining, ok}` pattern `snapshotCronOdds`
   relies on. Do not assume symmetry with `fetchSportOddsLive`.
2. Whether the ESPN competition object in the gameMeta loop (~line
   5580-5610) currently captures a game start-time field. It does not
   appear to (gameMeta pushes homeScore/awayScore/isFinal/venue/eventId
   but no start time) — confirm via a live ESPN scoreboard response
   (`curl site.api.espn.com/apis/site/v2/sports/.../scoreboard?dates=...`)
   what the correct field is (likely `comp.date`, ISO 8601) before adding
   it.
3. Current quota budget mechanics (`consumeOddsCredit`, `ODDS_QUOTA_FLOOR`)
   — this new call path fires once per finalized game per cron tick,
   potentially many games across many sports on a busy day. Must not
   silently exhaust the daily Odds API allowance meant for opening_odds
   capture. Read the full quota-guard logic before deciding thresholds.

## TASK 1: Capture game start time in gameMeta

In the ESPN scoreboard loop (~line 5580-5610), add the competition's
actual start timestamp to the `gameMeta.push({...})` object, e.g.
`startTime: comp?.date || null` (confirm field name per probe step 2).

## TASK 2: Pass start time through the catch-up POST to /archive/game

In the catch-up loop (~5630-5650), when POSTing to `/archive/game` for a
`gm.isFinal === true` game, add `start_time: gm.startTime` (and whatever
sport-key-lookup field `archiveSportToOddsKey` needs — match its expected
input casing/shape, verify don't assume) to the POST body.

## TASK 3: Extend /archive/game to capture closing_odds

In the `/archive/game` handler (index.js ~7712), after the existing
INSERT/UPDATE for home_score/away_score/etc succeeds:

- Only proceed if `start_time` was provided in the body AND the row does
  not already have `closing_odds` set (SELECT-check first — never
  overwrite an existing value, same COALESCE philosophy as the rest of
  this handler).
- Resolve `sportKey` via `archiveSportToOddsKey(sport)`; skip silently
  (log only, do not error the response) if no mapping exists.
- Quota-guard using the real mechanics found in the probe step — skip
  silently if below floor. This is a fire-and-forget enrichment; it must
  never affect the core score-archiving response or status code.
- Call `fetchSportOddsHistorical(env, sportKey, start_time)`.
- Match the specific game within the returned games array using the same
  `resolveTeamKey(home)|resolveTeamKey(away)` pairing pattern used in
  `snapshotCronOdds`.
- `extractOddsForGame()` on the match, `JSON.stringify`, UPDATE the row's
  `closing_odds` column on whichever table (`regular_season_games` or
  `postseason_games`) this id belongs to.
- Wrap the entire odds step in try/catch (Rule 5 — this must never break
  the core archive response).

## TASK 4: Verification (explicit, verifiable — not inferred)

Before state (use a date OTHER than 2026-06-28, which already has one
pre-seeded row per the Prior Art note above — that row is not a valid
signal for this test). Should show `hasClosing:false` everywhere, matching
the pre-deploy probe already on record:

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/odds-story/preview?date=<today's date>"
```

Deploy. Wait for at least one real game to go final during the CC session
window (MLB games finish daily — this is the fastest realistic test case;
check live scores or ESPN scoreboard directly rather than assuming
timing). After a game finalizes and one cron cycle has run:

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/odds-story/preview?date=<that date>"
```

**DONE CONDITION:** at least one game in the preview response shows
`"hasClosing": true` and a non-empty `"story"` field for a game that was
previously `hasClosing:false`. This must be the actual captured probe
output pasted into the outbox doc — not a claim that the code "should"
work. If no game finalizes within the session window, state that
explicitly as a carry-forward with the exact date/time last checked; do
not report success without the real false→true flip in hand.

## TASK 5: Outbox manifest (last task)

Write `outbox/cc-closing-odds-capture-2026-06-30.md` covering: what the
probe confirmed vs. what it corrected from this spec's assumptions, what
was built, the before/after `/odds-story/preview` output (or the explicit
non-flip if timing/quota didn't cooperate within the session), Odds API
quota consumed by this change, and any deviation from this spec with
reasoning.
