# Claude Code Command — club competitions are being written into the World Cup results and standings tables

**Repo:** field-relay-nba (`src/index.js`) · **Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug, production data) · **Filed:** 2026-11-07, found while reviewing the FA Cup registration
(`docs/CC-CMD-2026-08-08-fa-cup-coverage.md`, commit `a18d3d5`); searched by content first (BUILD-ON-A): no existing CC-CMD covers it. The
nearest are the June knockout-phase CC-CMDs that BUILT the path (`docs/CC-CMD-2026-06-27-relay-knockout-phase.md`,
`docs/CC-CMD-2026-06-29-wc-knockout-phase.md`, both DONE) and the owner's open `sport === 'wc26'` question about
`getWCPregameLambdas` (HANDOFF, 2026-11-05 close-out), which is a different function with the same shape of cause.
**Status:** FILED, NOT BUILT. Unblock criterion and the window rule are in "When this may land".

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
Arsenal 05-30, each filed with `group_id` `FINAL`). The standings table is polluted too:

```
SELECT group_id, COUNT(*) AS teams, MAX(played) FROM wc_group GROUP BY group_id
  A 4, B 5, C 4, D 6, E 6, F 4, G 5, H 5, I 6, J 4, K 5, L 5      max played 5 to 7
```

A World Cup group has four teams and each plays three games; groups of five and six teams, and `played` of 5 to 7, are club teams written
through the GROUP path (see Mechanism 2).

## Mechanism (read and run by two reviews, `wf_753e8877-a88` and `wf_2e9f8e6d-9e4`; the real worker driven with ESPN stubbed)

1. `extractWCPhase(round)` (src/index.js ~2486) matches `/third|3rd\s+place/` and `/final/`, so "Third Qualifying Round", "FA Cup, Third
   Round", "Carabao Cup, Third Round" give `third`, and any club "Final" gives `final`; "Quarterfinals" and "Semifinals" give `qf` and `sf`.
   `writeWCResult` then writes the row with `group_id` = the phase upper-cased. Run: `FA Cup, Third Round` -> third; `FA Cup, Fourth Round`
   and `First Round Proper` -> null (skipped); `FA Cup, Quarterfinals` -> qf; `Semifinals` -> sf; `Final` -> final.
2. `extractWCGroup(round)` (~2470) takes the FIRST `Group <A-L>` in the string. The real EFL Trophy round string is "EFL Trophy, Group
   Southern Group F" (recorded in `outbox/cc-session-2026-08-08-followup-closeout.md:113`); the regex skips "Group Southern" and returns `F`.
   The row is written as World Cup Group F and `recomputeGroupStandings` rewrites the World Cup `wc_group` table from every `group_id='F'` row,
   club rows included.
3. The same group read happens on a LIVE game: the live loop (~4796) reads `wc_group` for the game's group letter and stamps an
   `advancementProb` computed from World Cup standings. Run: `computeAdvancementProb(WC Group F, 'Barnet', 'Arsenal U21', wp)` returns
   0 and 0 for both sides. The EFL Trophy is in its group stage now, so this path is LIVE, not dormant. Whether any such stamp has been
   served to a client is UNVERIFIED.
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
judge `trig_019aQvU36rYwZ7PqjaMnV5ut`, 2026-11-24T14:00Z). So the code change lands either before 2026-11-08T00:00Z, with its own
review and the full gate set, or on or after 2026-11-24. The harm in waiting is bounded: nothing new from FA Cup before January; the
EFL Trophy group stage and UEFA/EFL ties keep adding rows through the window.

## Tasks (probe first, Rule 87)

0. **Probe block.** Re-read at HEAD: the call site (`grep -n "writeWCResult\|V2_NON_SOCCER_WP_SPORTS" src/index.js`), the live loop's `wc_group`
   read, and `V2_LEAGUES.wc26` (`espnLeague` must be `fifa.world`, and the only key with that slug:
   `node -e` over the evaluated constant). Re-run the two D1 queries above and record the counts.
1. **The guard, two sites, one condition.** At ~4875 replace the `V2_NON_SOCCER_WP_SPORTS` clause with `cfg.espnLeague === 'fifa.world'`
   (equivalent to `sport === 'wc26'`; `writeWCResult` already hard-codes `fifa.world` at ~3205 and the R2 prefix `bsd/wc26`), and at ~4796 guard
   the live `wc_group` read the same way. Do not touch `extractWCGroup`, `extractWCPhase`, `writeWCResult` or the sweep. The second review's
   harness over the real worker: World Cup rows kept 7 of 7, club rows written 0 of 33, a live club game reads no WC group; mutants of each
   (gate false, gate inverted, the lookup edit only, the writer edit only) went red.
2. **The check that holds it.** `scripts/check-v2-games-nba-board.mjs` pins the bug as a control (N8: an EPL final expects one `waitUntil`) and its
   three mutation anchors sit on the old gate line; the guard turns it red and orphans them. In the same commit: flip N8 to expect no write,
   add club fixtures (`Third Qualifying Round` on `uclqual`, `FA Cup, Final` on `facup`, `EFL Trophy, Group Southern Group F` on `efltrophy`)
   asserting zero `wc_results` inserts and no `wc_group` read, keep a `wc26` 'Group A' control, re-point the anchors, and mutate (Rule 90).
3. **Data cleanup, with the owner's approval first (a write to production).** Delete the club rows by date and team, not by phase: every
   `wc_results` row outside 2026-06-11..2026-07-19, and the group-path rows whose teams are not World Cup teams; then call
   `recomputeGroupStandings` for each affected letter. Preview with `SELECT` and the count before any `DELETE`; record both in the outbox.
4. **Execute inside the session** (Rule 87.3): after deploy, `probe_relay_route /wc/results` and the two D1 queries.

## Done condition (Rule 89, every line an artifact)

```
SELECT COUNT(*) FROM wc_results WHERE match_date < '2026-06-11' OR match_date > '2026-07-19'                 -- must be 0
SELECT group_id, COUNT(*) FROM wc_group GROUP BY group_id HAVING COUNT(*) <> 4                               -- must be EMPTY
node scripts/check-v2-games-nba-board.mjs --self-test                                                        -- the club fixtures and every mutant
```

and the real worker run over the 33 club cases and 7 World Cup cases printing `Club rows written: 0/33`, `World Cup rows kept: 7/7`.

## Also found, pre-existing, not part of this CC-CMD

`handleWCAdminSeed` throws `ReferenceError: bsd_event_id is not defined` after writing its row, so the standings recompute and the response are
skipped (run on the real handler by the second review; gated by `FIELD_MCP_SECRET`). A separate one-line fix; add it here when this is built.
