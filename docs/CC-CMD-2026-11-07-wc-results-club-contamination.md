# Claude Code Command — club competitions are being written into the World Cup results and standings tables

**Repo:** field-relay-nba (`src/index.js`) · **Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug, production data) · **Filed:** 2026-11-07, found while reviewing the FA Cup registration
(`docs/CC-CMD-2026-08-08-fa-cup-coverage.md`, commit `a18d3d5`); searched by content first (BUILD-ON-A): no existing CC-CMD covers it. The
nearest are the June knockout-phase CC-CMDs that BUILT the path (`docs/CC-CMD-2026-06-27-relay-knockout-phase.md`,
`docs/CC-CMD-2026-06-29-wc-knockout-phase.md`, both DONE) and the owner's open `sport === 'wc26'` question about
`getWCPregameLambdas` (HANDOFF, 2026-11-05 close-out), which is a different function with the same shape of cause.
**Status:** PARTIAL 2026-11-07. DEFECT A (club games written to the World Cup tables) FIXED in the push that carries this edit (the guard, its
check and a flipped control); the production DELETE (Task 3) awaits the owner. DEFECT B (World Cup knockout games filed through the GROUP path,
found while correcting this document) is FILED, NOT BUILT, and cannot be before 2026-11-24.** Unblock criterion and the window rule are in
"When this may land".

**Correction, same day.** This document first said the groups of five and six teams in `wc_group` were club teams written through the group
path. That was an inference, published before it was tested (Rule 100), and it was wrong: every team in `wc_group` is a World Cup team
(`SELECT ... FROM wc_group WHERE team NOT IN (WC-window group-row teams)` returns no rows, read 2026-11-07), and no `wc_results` row with
`phase = 'group'` is dated outside 2026-06-11..2026-07-18. The `wc_group` pollution is Defect B below. The club-game rows ARE real, but only in
`wc_results` (61 rows).

## Why this exists, measured 2026-11-07

`writeWCResult` runs for EVERY soccer game that reaches `final` on `/v2/games`, not for the World Cup only, and nothing in it or at its
call site asks which competition the game belongs to. Production D1 (`WC2026_DB`, id `f26669de-e772-4b56-a6d1-f8fdea08a4d4`, read-only
queries through the Cloudflare D1 tool, 2026-11-07 ~00:50Z):

```
SELECT phase, COUNT(*), MIN(match_date), MAX(match_date) FROM wc_results GROUP BY phase
  final 4  2026-05-20..2026-07-19     group 138  2026-06-11..2026-07-18     qf 4  07-09..07-12
  r16 8  07-04..07-07     r32 4  06-28..07-04     sf 2  07-14..07-15     third 58  2026-08-11..2026-09-16
```

The World Cup ran 2026-06-11 to 2026-07-19. Everything dated outside it is a club game: 58 `third` rows (UEFA qualifying "Third
Qualifying Round" ties such as Iberia 1999 v Larne, Bodo/Glimt v Union St.-Gilloise, Red Star Belgrade v Hapoel Be'er; one is Carabao Cup
2026-09-16) and 3 `final` rows from May (Freiburg v Aston Villa 05-20, Crystal Palace v Rayo Vallecano 05-27, Paris Saint-Germain v
Arsenal 05-30, each filed with `group_id` `FINAL`). That is Defect A: 61 club rows in `wc_results`, none in `wc_group`.

**Defect B, a different cause, measured the same day.** The standings table is polluted too, but with World Cup teams:

```
SELECT group_id, COUNT(*) AS teams, MAX(played) FROM wc_group GROUP BY group_id
  A 4, B 5, C 4, D 6, E 6, F 4, G 5, H 5, I 6, J 4, K 5, L 5      max played 5 to 7
SELECT group_id, team, played, points FROM wc_group WHERE group_id IN ('D','E','I')
  D: United States 6, Australia 6, Paraguay 5, Turkiye 5, Egypt 1, Bosnia-Herzegovina 1
  E: Germany 7, Ivory Coast 7, Ecuador 6, Norway 1, Curacao 6, Paraguay 1
  I: France 7, Norway 5, England 1, Senegal 5, Iraq 5, Sweden 1
SELECT substr(match_date,1,10), group_id, home, away FROM wc_results WHERE phase='group' AND match_date > '2026-06-27'
  06-28 J Jordan 1-3 Argentina; 06-29 E Germany 1-1 Paraguay; 06-30 E Ivory Coast 1-2 Norway; 06-30 I France 3-0 Sweden;
  07-01 L England 2-1 Congo DR; 07-02 D United States 2-0 Bosnia-Herzegovina; 07-03 D Australia 1-1 Egypt; 07-18 I France 4-6 England ...
```

A group has four teams and each plays three games, and the group stage ended 2026-06-27. These are World Cup KNOCKOUT games filed as GROUP rows:
`extractWCGroup` falls back to the team name (`_WC_TEAM_GROUP[home] || [away]`) when the round string holds no `Group <A-L>`, so a
knockout game is given its home team's group letter, `writeWCResult` takes the group path before the knockout path, and
`recomputeGroupStandings` puts the visiting team, from another group, into that group's table. 138 `group` rows against the 72 of a
48-team group stage. The World Cup is over; the standings table is wrong for the finished tournament. Not touched by the guard.

## Mechanism (read and run by two reviews, `wf_753e8877-a88` and `wf_2e9f8e6d-9e4`; the real worker driven with ESPN stubbed)

1. `extractWCPhase(round)` (src/index.js ~2486) matches `/third|3rd\s+place/` and `/final/`, so "Third Qualifying Round", "FA Cup, Third
   Round", "Carabao Cup, Third Round" give `third`, and any club "Final" gives `final`; "Quarterfinals" and "Semifinals" give `qf` and `sf`.
   `writeWCResult` then writes the row with `group_id` = the phase upper-cased. Run: `FA Cup, Third Round` -> third; `FA Cup, Fourth Round`
   and `First Round Proper` -> null (skipped); `FA Cup, Quarterfinals` -> qf; `Semifinals` -> sf; `Final` -> final.
2. `extractWCGroup(round)` (~2470) takes the FIRST `Group <A-L>` in the string. The real EFL Trophy round string is "EFL Trophy, Group
   Southern Group F" (recorded in `outbox/cc-session-2026-08-08-followup-closeout.md:113`); the regex skips "Group Southern" and returns `F`.
   On the real worker with a stubbed ESPN the row is written as World Cup Group F and `recomputeGroupStandings` rewrites the World Cup
   `wc_group` table from every `group_id='F'` row. **Not observed in production:** no club team is in `wc_group`. The path was open.
3. The same group read happens on a LIVE game: the live loop (~4796) reads `wc_group` for the game's group letter and stamps an
   `advancementProb` computed from World Cup standings. Run on the real worker (stub ESPN, a live "EFL Trophy, Group Southern Group F" game):
   it reads `wc_group` for `F`. `computeAdvancementProb(WC Group F, 'Barnet', 'Arsenal U21', wp)` returns 0 and 0 for both sides. Whether any
   such stamp was ever served is UNVERIFIED.
4. The only gate is at ~4875: `env.WC2026_DB && !V2_NON_SOCCER_WP_SPORTS.includes(cfg.espnSport)`. It excludes baseball, football, basketball and
   Australian football; every soccer key passes, all 18 club keys plus `wc26`. The second call site (~8336, the WC26 brief sweep) feeds
   `writeWCResult` only from rows already in `wc_results WHERE phase='group'`, so it inherits the pollution.

The FA Cup registration (`a18d3d5`) adds a feeder: FA Cup's Third Round, Quarterfinals, Semifinals and Final all write. The first is January 2027.

## Readers, and what is live (read from source by the second review; the numeric claim was run)

- `GET /wc/results` is public, has no World Cup window gate and returns `SELECT * FROM wc_results ORDER BY group_id, match_date`: the one
  user-reachable surface for the knockout-path club rows. The client does not show them (jubilant-bassoon `_wcBuildGroupInput` reads groups).
- `runWCMorningBrief` reads `wc_results` with no phase, group or window filter, daily 11-13 UTC, and builds a prompt "covering FIFA World Cup 2026
  results from overnight"; club rows enter it. Run on stub rows: it enqueues with `resultCount: 2`. The output is not user-visible (cost only).
- The group path also POSTs to BracketDO and enqueues a game brief with sport `wc26` ("this World Cup 2026 result", "Group: F") whose KV key is the
  one the club journalism cron uses for that ESPN event id (`brief:game:{eventId}`). Read, not run end to end. UNVERIFIED in production.
- A World Cup "Third Place" match is itself filed as a GROUP row (the team-name fallback matches England to L), so a cleanup keyed on
  `phase = 'third'` would be unsafe. Clean by date and by team, never by phase alone.

## When this may land (the calendar experiment)

`src/index.js` is on the judge's file list for the CFL calendar experiment: nothing in `src/index.js` may change from 2026-11-08 to
2026-11-23 (`docs/CC-CMD-2026-10-23-odds-spend-without-need.md`, "Do not read a `src/index.js` commit in 2026-11-08..11-23 as harmless";
judge `trig_019aQvU36rYwZ7PqjaMnV5ut`, 2026-11-24T14:00Z). The owner chose on 2026-11-07 to build the Defect A guard before the window; it
landed in the push that carries this edit. Defect B (and anything else in `extractWCGroup`, `extractWCPhase` or `writeWCResult`) lands on or
after 2026-11-24.

## Tasks (probe first, Rule 87)

0. **Probe block: DONE (Defect A).** The call site, the live loop's `wc_group` read, `V2_LEAGUES.wc26` (`espnLeague: 'fifa.world'`, the only key
   with that slug), and the two D1 queries above.
1. **The guard, two sites, one condition: DONE.** The finals gate (~4875) and the live loop's `wc_group` read (~4796) are `env.WC2026_DB &&
   cfg.espnLeague === 'fifa.world'`. `extractWCGroup`, `extractWCPhase`, `writeWCResult` and the sweep are untouched.
2. **The check that holds it: DONE.** `scripts/check-wc-tables-world-cup-only.mjs`: the real worker, every soccer key read from `V2_LEAGUES`
   (18) at five rounds plus four real strings, three live club games, `wc26` at six rounds and live as controls; red on the unfixed source,
   green on the fix, 8 of 8 mutants caught; in `deploy.yml`. `check-v2-games-nba-board.mjs`: N8's EPL control flipped (an EPL final is not
   handed to the writer), three anchors re-pointed, 10 of 10 caught.
3. **Data cleanup, with the owner's approval first (a write to production): NOT DONE.** By date and by team, never by phase (a World Cup
   third-place game is itself filed as a group row). `match_date` is the GAME's date (`(game.start || '').slice(0, 10)`), so the predicate is
   the tournament's dates. Preview, expected 61 rows today (58 `third`, 3 `final`), every home and away a club:
   `SELECT game_id, group_id, home, away, match_date FROM wc_results WHERE match_date < '2026-06-11' OR match_date > '2026-07-19' ORDER BY match_date`
   then, only after the owner approves the preview and the count: `DELETE FROM wc_results WHERE match_date < '2026-06-11' OR match_date >
   '2026-07-19'`. Record both in the outbox. Nothing in `wc_group` is a club team, so Defect A leaves nothing to clean there. One residue the
   guard cannot reach: a club game that was live at the deploy keeps the `openingAdvanceProb` GameDO stored for it (found by review, run on
   the real GameDO): the first poll after the deploy sends `null` and the stored value stays until the game ends.
4. **Execute inside the session (Rule 87.3):** deployed 2026-11-07 (Deploy RELAY Worker run `42333550176` `success`, Repo guards `42333550146` `success`); after
   the deploy `SELECT COUNT(*) ... outside the tournament's dates` read 61 of 218 (the baseline) and `/v2/games?sport=wc26&date=2026-07-19` answered 200 with
   `"league":"FIFA World Cup"`, the control. Still STAGED, as written next: after the deploy, `probe_relay_route /v2/games?sport=efltrophy&date=<a matchday>` still answers,
   and the first FA Cup or UEFA final after the deploy writes no `wc_results` row (STAGED: the next club cup tie reaching `final`; verify with the
   first query below, which must stay at 61 until the cleanup and then 0).

## Done condition, Defect A (Rule 89, every line an artifact)

```
node scripts/check-wc-tables-world-cup-only.mjs && node scripts/check-wc-tables-world-cup-only.mjs --mutate     -- self-test passed; 8 of 8
SELECT COUNT(*) FROM wc_results WHERE match_date < '2026-06-11' OR match_date > '2026-07-19'                 -- 61 now; must not GROW; 0 after Task 3
```

## Defect B — World Cup knockout games filed through the GROUP path (FILED, NOT BUILT; on or after 2026-11-24)

Evidence is above (the `wc_group` and late `group`-phase rows). Task 0: re-read `extractWCGroup`'s fallback and the order of `writeWCResult`'s two
paths against the real ESPN round strings of the 2026 knockout (`/v2/games?sport=wc26&date=2026-06-29`, a game day, through the relay) before
choosing the fix; do not write the fix from this paragraph. Likely shape: the knockout path must be taken when `extractWCPhase(round)` is set,
whatever the team-name fallback says, and `recomputeGroupStandings` must read only `phase = 'group'` rows with a group-stage date.
Cleanup (owner approval, a production write): re-derive `wc_group` from the 72 group-stage rows only. Done condition: `SELECT group_id,
COUNT(*) FROM wc_group GROUP BY group_id HAVING COUNT(*) <> 4` returns no rows, and `SELECT COUNT(*) FROM wc_results WHERE phase = 'group'`
returns 72. It affects the finished 2026 tournament's tables (the `/wc/*` routes still serve them); it is not urgent, and it cannot be built before the window closes.

## Also found, pre-existing, not part of this CC-CMD

`handleWCAdminSeed` throws `ReferenceError: bsd_event_id is not defined` after writing its row, so the standings recompute and the response are
skipped (run on the real handler by two reviews; gated by `FIELD_MCP_SECRET`). A one-line fix in `src/index.js`, so it cannot land 2026-11-08..11-23
and it was not folded into the guard (TOUCH-ONLY): build it with Defect B on or after 2026-11-24. A follow-up is scheduled for 2026-11-24 15:00Z, an
hour after the experiment's judge (`trig_019aQvU36rYwZ7PqjaMnV5ut`, 14:00Z) has read the window, to start Defect B, this fix, and the Task 3
cleanup request to the owner.
