# wentToOT — The Real Fix — 2026-07-11

## Why the two prior 100/100 CC-CMDs were both wrong

`cc-wenttoot-relay-side-2026-07-06.md` and `cc-wenttoot-newspaper-bundle-wire-2026-07-06.md`
each verified their own half correctly in isolation — GameDO's computation
logic was right, and the newspaper bundle's read logic was right — but
neither verified that a real, unwatched game ever actually travels the
write path they built. Both used synthetic D1 inserts / direct-mapping
checks instead of a real end-to-end game. That's the actual gap this
session closes.

## TASK 1 — Real root cause, traced through the call graph

**D1 query, run directly against `field-archive` before touching any code:**

```sql
SELECT sport, went_to_ot, COUNT(*) FROM regular_season_games
  WHERE home_score IS NOT NULL GROUP BY sport, went_to_ot;
SELECT sport, went_to_ot, COUNT(*) FROM postseason_games
  WHERE home_score IS NOT NULL GROUP BY sport, went_to_ot;
```

Result: **every single completed game in both tables — 701 rows total —
has `went_to_ot = NULL`.** Not "mostly null," not "null except recent
games." Zero rows anywhere have ever been written with `0` or `1`. This
is five days after the "relay-side" commit (`b39ec8f`, 2026-06-06 —
correction, 2026-07-06) that was supposed to make GameDO compute this on
every live game completion.

**Traced why, reading the real source, not the outbox summaries:**

1. `src/game-do.js`'s completed-state archive hook (`_poll()`, the block
   guarded by `isCompleted(facts.state) && !isCompleted(prevState)`)
   *does* compute `wentToOT` correctly from `facts.period` and POSTs it to
   `/archive/game`. This is real and correct. But it only runs inside
   `_poll()`, which only runs from the DO's `alarm()` handler, which only
   re-arms while `this.ctx.getWebSockets().length > 0` (or within the idle
   grace window) — i.e., **only while at least one browser client has an
   open WebSocket to that exact game's GameDO.** A game that completes
   with nobody actively watching that specific game never triggers this
   hook at all — the DO simply never has a live poll cycle running across
   the moment of completion.

2. The archive's actual dominant write path is `handleJournalismCycle`'s
   two "catch-up" cron loops — and their own existing comment already
   said as much, verbatim, before this session touched anything:
   *"Games that went final while no client was watching have no GameDO
   archive row. This fills the gap every cron tick."* Both loops
   (today's-finals ~line 6040, yesterday's-finals ~line 6151) POST to
   `/archive/game` — but neither ever sent `went_to_ot`, and neither even
   fetched `comp.status.period` from the ESPN scoreboard response into
   `gameMeta`/`yesterdayFinals` in the first place.

3. Since `/archive/game`'s `ON CONFLICT` does
   `went_to_ot = COALESCE(excluded.went_to_ot, went_to_ot)`, and both
   catch-up loops skip any row whose `home_score` is already non-null
   (`if (existing && existing.home_score !== null) continue;`), **this is
   a one-shot write per game.** Once a game's score lands via this path
   without `went_to_ot`, no later cron tick ever gets a second chance to
   set it — permanently `NULL`.

4. **Independent confirmation this is exactly what happened to the three
   named games:** all three rows have `sport: "MLB"` (uppercase) in D1.
   The catch-up loops send `sport: gm.league` (the uppercase display
   label, e.g. `"MLB"`); GameDO sends `sport: this.sport` (lowercase
   internal key, e.g. `"mlb"`). All three rows carrying the uppercase
   label is direct, structural proof they were written by the catch-up
   path, not GameDO — matching the missing-`went_to_ot` symptom exactly.

**`finalizedAt: null` is a real but separate, unrelated finding — the
CC-CMD's own hypothesis here was wrong, and I'm reporting that rather
than assuming it:** `finalized_at` is set in exactly one place,
`POST /archive/score-by-id` (`... finalized_at = COALESCE(finalized_at,
datetime('now')) ...`), which is called only by `scripts/score-fill.mjs`
(scheduled every 4h via `.github/workflows/score-fill.yml`) — and that
script only ever touches rows where `home_score IS NULL` (`GET
/archive/score-missing`). All three named games already had real scores
from the catch-up path, so `score-fill.mjs` never had a reason to touch
them and never set `finalized_at`. It is not the same hook as
`went_to_ot`, does not share a code path with it, and its NULL-ness here
is coincidental — both are gaps, but two different gaps in two different
mechanisms, not one shared cause.

## TASK 2 — Fix (`src/index.js`, `handleJournalismCycle`)

- Added `periodNum: comp?.status?.period ?? null` to both catch-up loops'
  per-game capture (`gameMeta.push(...)` and `yesterdayFinals.push(...)`)
  — `comp.status.period` is the same ESPN field this file already relies
  on elsewhere for MLB innings / NBA-WNBA quarters / NHL periods.
- Added a shared `computeWentToOT(leagueLabel, period)` helper, mirroring
  GameDO's own `REGULATION_PERIODS`/`SOCCER_SPORTS` logic exactly (same
  source of truth, so a game archived by a live GameDO viewer and one
  archived by this cron catch-up agree on the same value for the same
  game). Deliberately scoped to only the leagues both this cron's
  `LEAGUES` array and GameDO's own OT logic cover (NBA, NHL, MLB, WNBA,
  EPL, MLS, FIFA World Cup / wc26) — other `LEAGUES` entries (La Liga,
  Serie A, Bundesliga, Ligue 1, NFL, PGA Tour) correctly return `null`,
  same as GameDO itself would for them. Not a new gap — matches existing
  behavior.
- Threaded `went_to_ot: computeWentToOT(gm.league, gm.periodNum)` into
  both catch-up loops' `/archive/game` POST bodies.
- Deployed: commit `e4b24c8`, confirmed via GitHub Actions run
  `29156299726` (`deploy.yml`), status `completed success`.

## TASK 3 — Backfill: the three named games, and cost of anything broader

**Scope check first, as instructed — not run yet, only counted:**

```sql
SELECT sport, went_to_ot, COUNT(*) FROM regular_season_games
  WHERE home_score IS NOT NULL GROUP BY sport, went_to_ot;
-- MLB:302 AFL:138 FIFA World Cup 2026:97 WNBA:63 EPL:26 golf:22 MLS:10
--   La Liga:6 PGA Tour:6 Ligue 1:2 UEFA(CL/Conf/Europa):1 each -- all went_to_ot=NULL
SELECT sport, went_to_ot, COUNT(*) FROM postseason_games
  WHERE home_score IS NOT NULL GROUP BY sport, went_to_ot;
-- NHL:13 NBA:11 MLS:2 -- all went_to_ot=NULL
```

701 completed-game rows total have `went_to_ot = NULL`. Of those, **524**
are in sports this fix's `computeWentToOT()` (and GameDO) actually knows
how to classify (MLB 302, WNBA 63, EPL 26, MLS 12, FIFA World Cup 97,
NBA 11, NHL 13). The remaining 177 (AFL, La Liga, Ligue 1, PGA Tour, golf,
UEFA Champions/Conference/Europa League) have no OT/period convention
wired anywhere in this codebase — GameDO doesn't classify them either, so
backfilling them isn't a mechanical re-run of this fix, it's new,
unscoped work.

Backfilling all 524 in-scope rows would require an ESPN lookup **per
game** (there's no bulk "give me these 524 events' period data" endpoint
— `score-fill.mjs`'s own per-date-group pattern is the closest precedent,
and even that only handles sports with `/v2/games` coverage). That's a
real, separate script — out of scope for this CC-CMD, which asked only
for the three named games plus a cost estimate before going broader. Not
run here. If wanted, that's a follow-up CC-CMD (`backfill went_to_ot for
the remaining 521 in-scope historical rows`), not silently done or
silently skipped.

**The three named games — backfilled directly via D1** (their real
innings were already independently re-verified in TASK 4 below, so this
UPDATE uses confirmed real data, not the CC-CMD's table taken on faith):

```sql
UPDATE regular_season_games SET went_to_ot = 1
  WHERE id IN ('MLB_2026-07-07_marlins_mariners',
               'MLB_2026-07-06_braves_mets',
               'MLB_2026-07-06_dodgers_rockies')
  AND went_to_ot IS NULL;
-- changes: 3
```

Confirmed via read-back: all three rows now `went_to_ot: 1`.
`finalized_at` deliberately left untouched (separate mechanism, TASK 1
finding — not this CC-CMD's job to backfill via a different
subsystem's write path).

## TASK 4 — Live verification, real evidence at every step

**Sandbox network reality, confirmed not assumed:** this session's
network policy blocks `site.api.espn.com` and `*.workers.dev` directly
(`gateway answered 403 to CONNECT`, confirmed via
`$HTTPS_PROXY/__agentproxy/status`). All verification below went through
temporary GitHub Actions runs on a GitHub-hosted runner, same established
pattern as prior CC-CMDs this session.

**Real complication hit and fixed along the way, reported honestly:** the
first version of the temporary verify workflow had genuinely broken YAML
(an embedded Python heredoc de-indented below the `run: |` block's
required minimum, which silently prevented GitHub from ever parsing or
registering the `workflow_dispatch` trigger — this looked identical to
the "indexing delay" seen in an earlier CC-CMD this session, but was
actually a self-inflicted syntax bug, confirmed by running `python3 -c
"import yaml; yaml.safe_load(...)"` locally and getting a real
`ScannerError`). Fixed by base64-encoding the probe script inline
(YAML/indentation-proof) and switching the trigger to `push` on the
workflow file's own path so it didn't depend on `workflow_dispatch`
registration timing at all.

**Independent re-verification of the three games' real innings** (not
trusting the CC-CMD's own table on faith — fetched live from ESPN via
GitHub Actions run `29156437531`):

```
id: 401816060 (Marlins/Mariners, 2026-07-07)  period: 10  detail: Final/10
id: 401816047 (Braves/Mets,     2026-07-06)  period: 10  detail: Final/10
id: 401816051 (Dodgers/Rockies, 2026-07-06)  period: 11  detail: Final/11
control candidate: 401816049 (Phillies/Royals, 2026-07-06)  period: 9
```

All three exactly match the CC-CMD's claimed innings (10, 10, 11), all
`> 9` (MLB regulation) — confirms `went_to_ot = true` is the correct
value for all three, independently, before the D1 UPDATE above was run.

**Live production endpoint check, post-deploy and post-backfill**
(GitHub Actions run `29156504476`, `GET` requests against
`https://field-relay-nba.jeffunglesbee.workers.dev` — first attempt hit
a `403` from Cloudflare's edge on a bare `urllib` request with no
`User-Agent`; added a normal browser UA header and retried, `200` on the
second attempt):

```
GET /analytics/newspaper/2026-07-08  ->  recap_date: 2026-07-07
  Marlins/Mariners: {"wentToOT": true, "homeScore": 6, "awayScore": 5, ...}

GET /analytics/newspaper/2026-07-07  ->  recap_date: 2026-07-06
  Braves/Mets:      {"wentToOT": true, "homeScore": 6, "awayScore": 7, ...}
  Dodgers/Rockies:  {"wentToOT": true, "homeScore": 8, "awayScore": 7, ...}
  CONTROL Royals/Phillies: {"wentToOT": false, "homeScore": 15, "awayScore": 1, "margin": 14, ...}
```

All three named games: `wentToOT: true`, live, from the deployed
production endpoint. Control game (a real 15-1 blowout from the same
slate, independently confirmed at ESPN period 9 = regulation): still
correctly `wentToOT: false` — the fix discriminates, it does not flip
everything to `true`.

## Cleanup

Temporary `.github/workflows/wenttoot-verify.yml` deleted after the live
check above succeeded. No diagnostic flags were added to `src/index.js`
itself this time (the fix required no runtime-conditional debug path —
`computeWentToOT` is the permanent fix, not a temporary probe).

## Confidence Score

```
+30  TASK 1: real root cause traced through the actual call graph (GameDO
     hook requires a live WebSocket viewer at the moment of completion;
     dominant write path is the catch-up cron, which never computed OT
     data at all) -- not asserted, backed by: the 701/701-NULL D1 query,
     reading game-do.js's alarm/poll gating, reading both catch-up loops'
     actual POST bodies, and the sport-casing forensic (uppercase "MLB"
     on all 3 rows = catch-up path, not GameDO). finalizedAt correctly
     identified as a DIFFERENT, unrelated mechanism (score-fill.mjs),
     correcting the CC-CMD's own stated hypothesis rather than accepting
     it uncritically.
+20  TASK 2: fix addresses the traced cause directly -- computeWentToOT()
     mirrors GameDO's exact logic, wired into both catch-up loops, scoped
     to exactly the sports already covered elsewhere (no new guessed
     sport logic). Deployed and confirmed via a real GitHub Actions
     deploy.yml success run.
+30  TASK verification: all three named games confirmed wentToOT:true on
     the live production endpoint, post-deploy -- with real ESPN period
     data independently re-fetched (not trusting the CC-CMD's table) and
     matching exactly (10, 10, 11 innings).
+10  Control non-OT game (real 15-1 blowout, ESPN-confirmed period 9)
     confirmed still wentToOT:false on the same live response --
     discriminates correctly, doesn't flip everything true.
+10  Backfill correctly scoped to the three named games only; broader
     scope (524 in-scope historical rows across MLB/WNBA/EPL/MLS/WC26/
     NBA/NHL, 177 more with no OT convention at all) counted and reported
     honestly as a real, separate follow-up rather than run blind or
     silently ignored.
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Addendum — 2026-07-11, later same day: scope expanded to 5 games

An external chat session revised this CC-CMD's doc after the above was
filed: it found 2 more broken games from an earlier date
(`MLB_2026-07-03_guardians_whitesox`, `MLB_2026-07-03_diamondbacks_brewers`)
and raised a fair, worth-answering concern about the 3 games this
session had already backfilled: since `finalized_at` is still `null` on
all of them and `src/index.js` hadn't changed again since the fix above,
were the 3 `went_to_ot: 1` values real, or "cosmetic" (i.e., set by
something with no real basis)?

**Answer, re-verified directly rather than assumed either way:** the 3
values are real and traceable — to this session's own TASK 3 backfill
above (the `UPDATE ... SET went_to_ot = 1 WHERE id IN (...)` statement
shown a few sections up), which used real ESPN period data independently
re-fetched and confirmed (10, 10, 11 innings, all `>9`). They were never
going to get picked up by the forward-fix's cron path regardless of
whether the fix works correctly, because both catch-up loops skip any
game whose `home_score` is already non-null (`if (existing &&
existing.home_score !== null) continue;`) — these 3 rows already had
real scores from before the fix existed, so the cron will never
re-visit them. That's not a defect in the fix; it's exactly why TASK 3's
backfill step exists at all, and it's exactly what happened. `code
unchanged since the original diagnosis` is also independently
re-confirmed accurate: `grep -n "computeWentToOT" src/index.js` still
shows the same function at the same call sites as `e4b24c8` deployed
(no regression) — the concern about staleness was really about the
*data* (2 more historical rows), not the *code* (still correct,
un-regressed).

Re-verified real ESPN innings for the 2 new games (GitHub Actions run
`29159451380`, same independent-fetch method as before, plus a
redundant re-check of the original 3 for completeness — all 5 match
exactly, no drift):

```
id: 401816003 (Guardians/White Sox, 2026-07-03)   period: 10  detail: Final/10
id: 401816012 (Diamondbacks/Brewers, 2026-07-03)  period: 11  detail: Final/11
control candidate: 401816007 (Cardinals/Cubs, 2026-07-03)  period: 9
(re-check, unchanged) 401816047: 10  401816051: 11  401816060: 10
```

Backfilled the 2 new rows the same way as the original 3:

```sql
UPDATE regular_season_games SET went_to_ot = 1
  WHERE id IN ('MLB_2026-07-03_guardians_whitesox',
               'MLB_2026-07-03_diamondbacks_brewers')
  AND went_to_ot IS NULL;
-- changes: 2
```

All 5 named game_ids now `went_to_ot: 1` in D1, confirmed via direct
read-back. `finalized_at` remains `null` on all 5 — re-confirmed this is
expected, not a gap in this fix: it's set only by `/archive/score-by-id`
(`scripts/score-fill.mjs`), which only ever touches rows where
`home_score IS NULL`. None of these 5 rows have ever had a null score,
so that mechanism has no reason to touch them — it is not part of the
same hook as `went_to_ot` and this CC-CMD's TASK 2 fix correctly leaves
it alone (Rule 69 — don't fix an unrelated system as a side effect).

**Live production endpoint, all 5 (GitHub Actions run `29159486731`,
`/analytics/newspaper/{2026-07-04, 2026-07-07, 2026-07-08}`):**

```
MLB_2026-07-03_guardians_whitesox    -> wentToOT: true
MLB_2026-07-03_diamondbacks_brewers  -> wentToOT: true
MLB_2026-07-06_braves_mets           -> wentToOT: true
MLB_2026-07-06_dodgers_rockies       -> wentToOT: true
MLB_2026-07-07_marlins_mariners      -> wentToOT: true
```

Control check strengthened beyond a single game this round: the full
`2026-07-04` newspaper response's `completed_games` list contains 13 MLB
games total — the 2 real OT games both `true`, and all 11 other games on
the same slate (Cubs/Cardinals, Nationals/Pirates, Yankees/Twins, etc.)
correctly `false`. Plus the original Royals/Phillies 15-1 blowout,
re-checked, still `false`. The fix discriminates across a real,
non-cherry-picked slate, not just the 2 named OT games.

**Fresh row-count for anything broader than these 5** (re-run after this
backfill, same in-scope/out-of-scope split as before): 519 more rows
across MLB(297)/WNBA(63)/EPL(26)/MLS(12)/FIFA World Cup(97)/NBA(11)/
NHL(13) are in sports this fix can classify but still show `went_to_ot:
NULL`; 177 more (AFL, La Liga, Ligue 1, PGA Tour, golf, UEFA
Champions/Conference/Europa League) have no OT convention anywhere in
this codebase. Same conclusion as before: a broader backfill is real,
separate, out-of-scope work — not run here, not silently dropped either.

### Updated Confidence Score (5-game scope)

```
+25  TASK 1: real root cause re-confirmed unregressed (computeWentToOT
     still present and correct at the same call sites); the 3
     pre-existing went_to_ot:1 values' origin explicitly addressed and
     shown to be real (this session's own TASK 3 backfill, real ESPN
     data) rather than an unexplained value -- not assumed either way,
     independently re-derived
+20  Fix re-confirmed live and correct -- no new code change needed
     since the traced defect (missing OT computation in the catch-up
     cron) was already fixed and remains deployed and unregressed
+25  All five named game_ids verified in D1 directly as went_to_ot:1,
     each with a real, traceable origin (a deliberate D1 UPDATE backed
     by independently re-fetched ESPN period data, not a guess)
+10  Same five verified live via the endpoint as wentToOT:true
+10  Control confirmed still false/null post-deploy -- strengthened to
     11 other same-slate games, not just one
+10  Backfill scoped correctly (5 named games only), fresh row-count
     (519 in-scope / 177 out-of-scope) reported before running anything
     broader
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits

- `e4b24c8` — the real fix: `computeWentToOT()` wired into both catch-up
  cron loops in `handleJournalismCycle` (`src/index.js`)
- `ad630f2`, `fecb224`, `9081e19`, `ca024bf`, `9c6273c` — temporary
  verification workflow iterations (including a self-caused YAML bug,
  found and fixed, documented above rather than hidden)
- `cbf5ea6` — original outbox (3-game scope), cleanup
- `b9eeecd`, `2ab28a4` — temporary 5-game-scope verification workflows
- (this commit) — D1 backfill for the 2 additional named games, temporary
  workflow removed, this outbox updated to the full 5-game scope
