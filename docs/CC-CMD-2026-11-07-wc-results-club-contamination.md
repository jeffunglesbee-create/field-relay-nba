# Claude Code Command — club competitions are being written into the World Cup results and standings tables

**Repo:** field-relay-nba (`src/index.js`) · **Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug, production data) · **Filed:** 2026-11-07, found while reviewing the FA Cup registration
(`docs/CC-CMD-2026-08-08-fa-cup-coverage.md`, commit `a18d3d5`); searched by content first (BUILD-ON-A): no existing CC-CMD covers it. The
nearest are the June knockout-phase CC-CMDs that BUILT the path (`docs/CC-CMD-2026-06-27-relay-knockout-phase.md`,
`docs/CC-CMD-2026-06-29-wc-knockout-phase.md`, both DONE) and the owner's open `sport === 'wc26'` question about
`getWCPregameLambdas` (HANDOFF, 2026-11-05 close-out), which is a different function with the same shape of cause.
**Status:** PARTIAL 2026-11-24. DEFECT A (club games written to the World Cup tables) FIXED 2026-11-07 (the guard, its check and a flipped control).
DEFECT B (World Cup knockout games filed through the GROUP path) FIXED 2026-11-24, in the push that carries this edit, with
`scripts/check-wc-knockout-not-group.mjs`. `handleWCAdminSeed`'s ReferenceError is the next commit. The production writes await the owner: Task 3 (the 61
club rows) and Task 3b (10 misfiled knockout rows, 56 duplicate legacy rows, the `wc_group` rebuild), with their previews, read 2026-11-24, below.

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
- A World Cup "Third Place" match is itself filed as a GROUP row (the team-name fallback matches France to I (the home team's group)), so a cleanup keyed on
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
   green on the fix, 11 of 11 mutants caught; in `deploy.yml`. `check-v2-games-nba-board.mjs`: N8's EPL control flipped (an EPL final is not
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
node scripts/check-wc-tables-world-cup-only.mjs && node scripts/check-wc-tables-world-cup-only.mjs --mutate     -- self-test passed; 11 of 11
SELECT COUNT(*) FROM wc_results WHERE match_date < '2026-06-11' OR match_date > '2026-07-19'                 -- 61 now; must not GROW; 0 after Task 3
```

## Defect B — World Cup knockout games filed through the GROUP path (FIXED 2026-11-24)

**Task 0, read 2026-11-24 before the fix.** The round strings the relay serves for the finished 2026 tournament
(`/v2/games?sport=wc26&date=<day>` through `probe_relay_route`). Group: ESPN's `FIFA World Cup, Group A` (also `Group D`, `G`, `H`, `J`) and BSD's
`group_name`, which the relay puts in `round` when it matches (`Group A` for the 06-11 opener; `Group B`, `I`, `K`, `L`). Knockout, all ESPN's: Round of 32
`FIFA World Cup, Round of 32` (06-28, 06-29); Round of 16 `FIFA World Cup, Round of 16` (07-05); quarterfinals `FIFA World Cup, Quarterfinals` (07-10);
semifinals `FIFA World Cup, Semifinals` (07-14); third place **`FIFA World Cup, 3rd-Place Match`** (07-18); final `FIFA World Cup, Final` (07-19).
**These reads wrote to production.** `GET /v2/games` runs `writeWCResult` for every final on the board (`INSERT OR IGNORE`, then a score `UPDATE`, and for the group
path `recomputeGroupStandings`, a BracketDO notification and a game-brief enqueue), so a Task 0 read is not read-only. Observed afterwards (SELECTs, 2026-11-24): `wc_results`
gained one row, `espn:760488` (r32, Netherlands 1-1 Morocco, 06-30, `created_at` 15:01:31Z, correct content; every other final on those boards already had a row, so its INSERT
was ignored and its UPDATE wrote the same scores, by the code); `ARCHIVE_DB.briefs` gained 6 `bracket_delta` rows (`source` `bracket_do`, 15:12 to 15:20Z, game ids 760481, 760484,
760417, 760416, 760474, 760479) and one Haiku `game_recap` (`espn:760484`, 15:13:05Z). Attribution to these reads is inferred from the code and the timestamps, not proven. Each BracketDO
recompute fetches `/wc/odds-probs`: the ledger shows 0 credits for it on 11-24 (6 calls tallied, 4 cache hits and 2 reconciled at 0), so "no credits" holds, and "no odds route called
directly" is the claim, not "none reached".

**What the rows say (WC2026_DB, read-only SELECTs, 2026-11-24), and two premises of this document that were wrong (Rule 100).**
- Of the 138 `phase='group'` rows, 12 are dated after 2026-06-27, and **10** are knockout games: nine Round of 32 (`espn:760489`, `760490`, `760492` to
  `760497`, `760499`; 06-29 to 07-03) and the third-place game (`espn:760516`, 07-18, France 4-6 England, filed under group I). The other two,
  `espn:760483` and `760484` (Jordan v Argentina, Algeria v Austria), kicked off 2026-06-28T02:00Z and are "FIFA World Cup, Group J": real group games whose
  UTC date is 06-28. "Why this exists" above listed them as knockouts.
- "138 group rows against the 72 of a 48-team group stage" was read above as 66 knockout games. It is 10 knockouts and **56 duplicate legacy rows**: 55
  `football:<api-sports fixture>` rows (06-11 to 06-25) and 1 `manual:` row, each with an `espn:` twin in the same group with the same score (56 of 56;
  Bosnia's spelling differs between the sources, "Bosnia and Herzegovina" and "Bosnia-Herzegovina"). Every group-stage game was counted twice, which is why a
  group shows `played` 6 for a team that played 3.
- D1 holds 14 of the 16 Round of 32 games (the 5 correct rows include `espn:760488`, written by the Task 0 read above; 13 and 4 before it). Two have no row (`espn:760491` Mexico 2-0 Ecuador and `760498`
  Switzerland 2-0 Algeria, both in `ARCHIVE_DB.regular_season_games`, so they were played). Why they have no row is not tested. A board request on their dates may write them as r32 if
  their round names the phase (untested), so the r32 count is 14 to 16.

**Cause.** The third-place game is REPRODUCED on the string the relay serves today, and the old code's answer matches the stored row: neither extractor had a
word for "3rd-Place" (`extractWCPhase`'s `3rd\s+place` needs whitespace, `extractWCGroup`'s guard `round of|quarter|semi|final` has none), so the team-name
fallback filed France under group I. The string at write time is not stored. The nine Round of 32 games are INFERRED, not measured, and the inference is
incomplete: all nine rows were created before `07bc51a8` (2026-07-03 22:41Z), which gave the adapter `comp.altGameNote`, and every knockout row created after
it is right except the third-place game, which the `3rd-Place` string explains (`760500` onward: 2 r32, 8 r16, 4 qf, 2 sf, 1 final). In all ten misfiles the filed group is the HOME team's group in the old table, which is what the
fallback does, and which an unfiltered BSD lookup would give as well (below). Before that commit the adapter's round was `''` (from `4d6dc36d`, 06-26) and then `comp.notes[0].headline`, advancement text such as "Egypt
advance 4-2 on penalties" (from `d9d3ce95`, 06-30 21:42Z); the old `extractWCGroup` files both under the home team's group. Against that: two Round of 32
rows created under the `''` adapter are right (`760486`, 06-28; `760487`, 06-29), and what wrote them is not identified (BSD's `group_name` is null on those
events today). `07bc51a8`'s message says the old phase extractor "returned null for every knockout game -- silently skipping every WC26 knockout result": the
data say they were not skipped but filed as group rows, and two were filed right. Line numbers in the older sections of this document predate this push.
A second path to the same row is real and reproduced with a stubbed BSD: `if (_hit.group_name) _g.round = _hit.group_name` replaced an ESPN knockout round with
BSD's group name, and the writer filed the game as a group row. It is an alternative explanation for the same window, not an observed cause: the lookup used an
unfiltered `date=` parameter from `f3d3a68c` (2026-06-26) until `101d2013` (2026-08-02), and a hit on the home team's own group game gives the home team's group letter, which
is the fallback's answer too. BSD's `group_name` is null on all 9 knockout events read on 2026-11-24 (of 32).

**The fix (`src/index.js`).**
1. `extractWCGroup(round)` reads the group from the round string alone (`Group <A-L>`), returns null for a round that names a knockout phase (a design choice:
   no real string names both, and a group string that happened to contain "final" would now be read as a knockout game), and has no team-name fallback.
   `_WC_TEAM_GROUP` is deleted (no other reader). A round that names neither a group nor a phase is not written: **absent and silent**, with no log, so the
   only detector is a row count, instead of a row under a group chosen from the home team's name.
2. `extractWCPhase` matches `3rd[\s-]+place`: "3rd-Place Match" is `third`.
3. The BSD enrichment no longer replaces a round that names a knockout phase with BSD's `group_name`.
4. The dead-hours WC26 sweep re-writes a group row under the group stored in the row (`round: \`Group ${g.group_id}\``). It used `round: ''` and a cross-check that
   re-derived the group from the team names, which the removed fallback made impossible. The stored group is what the writer re-asserts: the ten misfiled rows
   stay misfiled until Task 3b (the sweep is dormant today: all 82 `espn:` group rows have a `game_recap` brief).
5. Not changed, on purpose: `recomputeGroupStandings` (no code path writes a non-group row under a group letter any more; the Task 3b SQL names its own
   `phase`), and `handleWCAdminSeed`'s group validation (admin-gated).

**The check.** `scripts/check-wc-knockout-not-group.mjs` (in `deploy.yml`): the real worker; the six real knockout strings with the real finalists, as finals
(every column of the row asserted) and live; four rounds that name neither a group nor a phase (`''`, the advancement headline, the api-sports matchday format),
which must touch nothing at all; a round naming both; BSD's `group_name` on a knockout game and on a game whose ESPN round says nothing; the dead-hours sweep
driven through the real `scheduled` handler (one run with a tried marker); the extractor's edges; all twelve group letters and the bare `Group A` as controls, every column
and the score UPDATE asserted; and every request asserts no D1 member beyond `prepare` and no rejected writer. Red on the unfixed source (13 cases), green on the fix,
27 of 27 mutants caught. One independent review (four read-only reviewers) ran before it was committed and its findings are fixed here; what the check does not cover is printed with its result.

## Task 3b: the cleanup of the group rows (a production write, NOT DONE, needs the owner's approval first)

Previews, read-only, 2026-11-24 (every number below was returned by D1). **Order: 1, 1b, 1c, 2, 3, then 4 last** (4 reads what the others leave; run first it
rebuilds the polluted table).
1. **10 knockout rows filed as group**, to reclassify (not delete): `SELECT game_id, group_id, home, away, match_date FROM wc_results WHERE phase = 'group' AND
   game_id IN ('espn:760489','espn:760490','espn:760492','espn:760493','espn:760494','espn:760495','espn:760496','espn:760497','espn:760499','espn:760516')`
   returns 10 rows. Then `UPDATE wc_results SET phase = 'r32', group_id = 'R32' WHERE game_id IN ('espn:760489','espn:760490','espn:760492','espn:760493',
   'espn:760494','espn:760495','espn:760496','espn:760497','espn:760499')` (9 rows) and `UPDATE wc_results SET phase = 'third', group_id = 'THIRD' WHERE game_id =
   'espn:760516'` (1 row): what the fixed writer binds.
1b. **Two `bsd_event_id` values that exist only on rows step 2 deletes:** `football:1489410` (Ecuador v Germany) holds 8342 and its twin `espn:760468` holds NULL;
   `football:1489409` (Curacao v Ivory Coast) holds 8341 and `espn:760473` holds NULL. Before step 2: `UPDATE wc_results SET bsd_event_id = '8342' WHERE game_id =
   'espn:760468' AND bsd_event_id IS NULL` and `UPDATE wc_results SET bsd_event_id = '8341' WHERE game_id = 'espn:760473' AND bsd_event_id IS NULL`. (Otherwise
   `/admin/wc/bsd-backfill` can re-derive them.)
1c. **Bosnia's spelling (the owner's choice).** The four `espn:` rows with Bosnia (`760416`, `760439`, `760462` in group B, and `760494`, now an r32 row) hold
   "Bosnia-Herzegovina"; the three legacy rows with Bosnia hold "Bosnia and Herzegovina", which is also what `resolveTeamName` returns today and what the client's group B list
   (jubilant-bassoon `src/legacy/field.js:32059`) names; the client's name table (`_WC_NAME_FIX`) has no mapping from the hyphen form. After step 2 group B would carry only the hyphen
   form; how the client then renders group B is UNVERIFIED. If approved: `UPDATE wc_results SET home = 'Bosnia and Herzegovina' WHERE home = 'Bosnia-Herzegovina'`
   and the same for `away` (4 rows). The other spellings the current `resolveTeamName` would change ("Congo DR" to "DR Congo", "Ivory Coast" to "Côte d'Ivoire") are
   the same in the legacy twins and in every stored row, and are left as they are.
2. **56 duplicate legacy rows**, to delete: `SELECT game_id, home, away, match_date FROM wc_results WHERE phase = 'group' AND game_id NOT LIKE 'espn:%'` returns 56;
   each has an `espn:` twin in the same group with the same score (56 of 56). Then `DELETE FROM wc_results WHERE phase = 'group' AND game_id NOT LIKE 'espn:%'`.
3. **The 61 club rows** (Task 3 above), unchanged. Steps 1, 2 and 3 are pairwise disjoint (no row is hit twice); 1c also touches `espn:760494`, a different column of a row step 1 reclassifies.
4. **`wc_group` rebuilt from the 72 remaining group rows, last:** `DELETE FROM wc_group`, then, in the same batch, the INSERT of `recomputeGroupStandings` run over
   every group:
   ```
   INSERT INTO wc_group (group_id, team, played, won, drawn, lost, gf, ga, gd, points)
   SELECT group_id, team, SUM(played), SUM(won), SUM(drawn), SUM(lost), SUM(gf), SUM(ga), SUM(gf) - SUM(ga), SUM(won)*3 + SUM(drawn)
   FROM (SELECT group_id, home AS team, 1 AS played, CASE WHEN home_score > away_score THEN 1 ELSE 0 END AS won, CASE WHEN home_score = away_score THEN 1 ELSE 0 END AS drawn,
                CASE WHEN home_score < away_score THEN 1 ELSE 0 END AS lost, home_score AS gf, away_score AS ga FROM wc_results WHERE phase = 'group'
         UNION ALL
         SELECT group_id, away AS team, 1, CASE WHEN away_score > home_score THEN 1 ELSE 0 END, CASE WHEN away_score = home_score THEN 1 ELSE 0 END,
                CASE WHEN away_score < home_score THEN 1 ELSE 0 END, away_score, home_score FROM wc_results WHERE phase = 'group') r
   GROUP BY group_id, team
   ```
   Simulated read-only on the post-cleanup rows (the `espn:` group rows minus the ten ids): 72 result rows give **48 `wc_group` rows, 12 groups of 4 teams, each team
   played 3, 6 matches a group**. `wc_third_place_standings` is a view over `wc_group` and corrects itself.

**Not reached by these writes (owner decisions, not part of the approval above).** (a) BracketDO keeps `snapshot:current`, `results:all` and the rest in its own storage and
rebuilds only on a new result or on `/wc/bracket/refresh`; that route makes the DO fetch `/wc/odds-probs`, which by the route's own comment can charge up to 4 credits per uncached call (the ledger shows 0 net since 2026-09-22), so it was not called here. (b) The 10
misfiled games have `game_recap` briefs in `ARCHIVE_DB` that frame them as group games ("a perfect nine-point haul to dominate Group D"). (c) KV `wc:projections:current` and
`wc:bracket:current` have a 7-day TTL and `wc:movers:current` a 1-day TTL, so they have probably expired; the first `/wc/projections` miss recomputes from `/wc/standings` and `/wc/results`,
so it should come after the cleanup.

Done condition (Rule 89), after the owner's approval and the writes (the r32 count is a floor, because a board request writes the two missing games):
```
SELECT group_id, COUNT(*) FROM wc_group GROUP BY group_id HAVING COUNT(*) <> 4                  -- no rows
SELECT COUNT(*) FROM wc_results WHERE phase = 'group'                                          -- 72
SELECT COUNT(*) FROM wc_results WHERE match_date < '2026-06-11' OR match_date > '2026-07-19'    -- 0
SELECT phase, COUNT(*) FROM wc_results GROUP BY phase    -- group 72, r32 >= 14, r16 8, qf 4, sf 2, third 1, final 1
```

## Also found, pre-existing, not part of this CC-CMD

`handleWCAdminSeed` throws `ReferenceError: bsd_event_id is not defined` after writing its row, so the standings recompute and the response are
skipped (run on the real handler by two reviews; gated by `FIELD_MCP_SECRET`). A one-line fix in `src/index.js`, built in the next commit of 2026-11-24.
