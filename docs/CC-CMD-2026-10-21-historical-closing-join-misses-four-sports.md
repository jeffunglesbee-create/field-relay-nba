# Claude Code Command — the historical closing path pays for four sports it can never write

**Date:** 2026-10-21
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a fetch that cannot produce its write)
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL. Shape (a) LANDED 2026-10-25: `d46106b` and `f4bea6a`, pushed 14:31Z, deploy run 40202657716 green at 14:38Z. Done condition 2 is met by `scripts/check-odds-join-shared.mjs` (19 of 19, 21 of 21 mutations). Done conditions 3 and 4 wait on the first closed days after the deploy (read from 2026-10-27 12:00Z, `trig_01N9VpHitdamufLWMkqWx6un`). RULED 2026-10-23: shape (a), make the join match. Session doc: `outbox/cc-session-2026-10-25-shared-join.md`.
**Filed by:** the per-consumer demand measurement
(`docs/CC-CMD-2026-09-16-odds-spend-attribution.md` Task 2). Rule 87.4: found
in its adversarial review, outside its scope.
**Widened 2026-10-23:** the opening-line cron (`snapshotCronOdds`) pays for
the same four sports through the same `findOddsForRow` and writes none of
their opening lines. That was filed as fix 2 of
`docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md` and is folded here
(BUILD-ON-A): one join, one owner choice. This document now blocks the hold
on Task 3 of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`.
**Related:** `docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md`
(FILED) already covers CFB's join. This document covers the shared cause in
all four sports and what it costs.

---

## What was measured (2026-10-21)

The `/archive/game` closing path checks three things before it writes a closing
line: the row is final, it has no `closing_odds`, and it has no `inplay_odds`.
It then calls `fetchSportOddsHistorical` (30 credits) and writes only if
`findOddsForRow` (`src/odds-join.js`) matches the archive's home and away names
to a vendor event.

For NBA, NHL, NFL and CFB the match never succeeds, but the fetch is still made
and paid for.

- **The join, run on real names.** The real `indexOddsByPair` and
  `findOddsForRow` were run on the vendor names in `odds_history` against the
  archive's names for the same games, 2026-10-15 to 2026-10-20. Matches by sport:

  | sport | matched |
  |---|---|
  | NHL | 0 of 11 (e.g. 'Columbus Blue Jackets' against 'Blue Jackets') |
  | CFB | 0 of 4 |
  | NFL | 0 of 2 |
  | NBA | 0 of 2 |
  | MLB | 1 of 1 |
  | CFL | 1 of 1 |
  | WNBA | 1 of 1 |
  | MLS | 2 of 2 |

- **The path's own record agrees.** `archive_game_closing` writes in change_log
  since 2026-09-01: MLB 320, MLS 104, WNBA 44, EPL 37, Serie A 28, La Liga 23,
  CFL 22, Ligue 1 13, Bundesliga 2. NBA, NHL, NFL and CFB have 0, across seven
  weeks of NFL and CFB play.
- **The cost.** Over 2026-10-14 to 2026-10-20, 19 of the path's 48 demand
  units were in these four sports. That is 570 of its 1,620 charged credits,
  and they bought nothing it could write.

Those four sports' closing lines arrive the next day from odds-backfill, which
runs in CI and calls the vendor directly.

`scripts/measure-odds-consumer-demand.mjs` keeps these units out of demand
through a dated constant, `JOIN_UNWRITABLE`, and prints them as "unwritable".

## TASK 0 — premises, one command each (Rule 100)

1. **The cause of the miss.** For the 19 games in the table above, log what
   `resolveTeamKeyIn(archiveName, vendorKeys)` returns. It is the archive's
   short name against the vendor's full name, or something else.
2. **Who owns the name.** Read the archive writers for these four sports and
   record which one stores the short name, and whether the client reads it.
3. **The leak is the fetch, not the join.** Count the 30-credit fetches this
   path made for the four sports over 14 days. This uses the change_log
   absence above, and the reconcile tally for fetchSportOddsHistorical.

## The opening-line cron, the same join (added 2026-10-23)

Found by the Task 3 premise test (workflow `wf_c984c219-a1f`):
- `snapshotCronOdds` (called from `handleJournalismCycle`) buys
  `fetchSportOddsLive` for every live-hours sport, NBA, NHL, CFB and NFL
  included, and writes opening lines through `findOddsForRow`.
- Over 10-14..10-23 the cron (`change_log` source `odds_api`) wrote opening
  lines for MLS 55, Serie A 10, EPL 10, MLB 8, La Liga 7, Ligue 1 6, WNBA 3,
  Bundesliga 1, and **0** for NHL, NBA, CFB and NFL. The next-day CI backfill
  wrote NHL 73, CFB 38, NBA 15, NFL 4.
- `fetchSportOddsLive` was the largest site on 10-23 (267 of 492 credits by
  20:00Z). How much of it is these four sports is UNVERIFIED: the tally has
  no sport column.
- TASK 0 gains a fourth premise: the cron's matches and its billed calls per
  sport over 10-14..10-23, one command (a worker tail over one live-hours
  window, counting `fetchSportOddsLive` URLs by sport key). Count by caller
  too: `/identity/mismatches` bills under the same label (weekly Saturday
  workflow, up to 5 calls a run).

**What a read-only map found toward premises 1 and 4** (2026-10-23, workflow
`wf_de43d4bd-def`; no credits). Re-run at dispatch:
- `change_log` source `odds_api` field `opening_odds`, 10-14..10-23: 0 rows
  for NHL, NBA, CFB and NFL (re-checked by one D1 query, 2026-10-23). This
  writer stamps `ts` as ISO (`2026-10-23T10:01:39.229Z`), unlike
  `odds_backfill` and `closing_odds_capture`, which use a space. Bound days by
  `substr(ts,1,10)`, which works for both.
- The real `indexOddsByPair` and `findOddsForRow`, run on recorded vendor
  names against the archive's names for 112 games (10-14..10-22): NHL 0/57,
  CFB 0/36, NBA 0/15, NFL 0/4. The archive stores the nickname or school
  (`Capitals`, `Knicks`, `Missouri St`), the vendor the full name
  (`Washington Capitals`); `resolveTeamKey` has no alias for these. Controls
  through the same join: MLB 23/23, WNBA 8/8, MLS 34/36, CFL 7/7.
- The closing capture already matches these names per team
  (`resolveTeamKey(b) === resolveTeamKey(v) || nameMatches(b, v)`, within the
  contested-kickoff window, either orientation, exactly one event;
  `src/ambient-do.js`). The same rule replayed on the 112 pairs: 110 right,
  0 wrong ('Western KY' and 'GA Southern' unmatched); 74/74 controls kept.
- Cost, modelled (the tally has no sport column): of 3,519 credits charged to
  `fetchSportOddsLive` over 10-14..10-23, about 2,373 (67%) fall on the four
  sports, by apportioning each day's charge over the sports pending per tick.
  On 10-20 the site charged 264 credits and wrote 0 opening lines.

5. **Who triggers the historical fetches** (added 2026-10-23, from
   `docs/CC-CMD-2026-10-23-odds-spend-without-need.md`, BUILD-ON-A).
   `fetchSportOddsHistorical` billed 30 calls against 5 demand units on 10-22
   (12 against 3 on 10-21; 10-14..10-20 ran at 1.0-1.75 a unit). Three
   triggers share the label: the `/archive/game` closing write, the dead-hour
   `runOddsBackfillForDate`, and the `/archive/odds-backfill` route. Count
   calls by trigger in the same worker tail as premise 4, on a closed day
   after the 10-22 capture deploys (the 10-22 tally straddles two deploys).
   The route's share is
   `docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md`; file a new
   CC-CMD only for excess outside the four sports.

## TASK 1 — decided from TASK 0

**Owner ruling 2026-10-23: "(a) Make the join match".** Put to the owner with
the read-only map of workflow `wf_de43d4bd-def`: the closing capture's
per-team rule, replayed on 112 recorded name pairs of the four sports, chose
110 right and 0 wrong, and kept 74 of 74 controls. Modelled saving on the
opening cron about 150-230 credits a day. Built as one change to the join behind
all three `findOddsForRow` callers, with a refusal after kickoff,
`JOIN_UNWRITABLE` removed in the same change, and the purchase dedup (the
map's commit B) after it as its own concern. It lands after the 2026-10-25
11:07Z read, which runs `scripts/measure-odds-consumer-demand.mjs`.

**Two further owner rulings, 2026-10-23,** after a read-only design and two
critics (workflow `wf_0d274771-67f`) found consequences the first choice had
not shown:
1. **The closing path: "Fix it as first ruled".** Matched, `/archive/game`
   writes the noon historical snapshot as `closing_odds` for NBA, NHL, CFB and
   NFL. Put to the owner with D1 (since 10-01): the CI backfill's pre-kickoff
   closing lines for these sports land 21-82 minutes before kickoff (CFB 34
   rows, avg 77; NBA 8, 82; NFL 10, 21; NHL 57, 69); the noon snapshot on the
   same rows is 736-798 minutes before. CI fills only empty rows
   (`.github/scripts/odds-backfill.js`), so the noon line takes the row. The
   blob's `_kickoff` carries the capture instant, so a reader can see the lead.
   NBA and NHL rows the AmbientDO capture fills at T-10 are not affected (the
   closing path skips a row that has a line).
2. **CFB: "Include CFB".** The opening cron writes CFB opening lines the same
   morning, before every kickoff. This changes which writer fills CFB
   `opening_odds` while `docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md`
   forbids changing what the backfill writes until its A1; the owner ruled
   it, and the ruling is recorded there too.

**Design changes from the critics** (each measured; built into the change):
- The worker backfill (`runOddsBackfillForDate`) gets the same after-kickoff
  refusal, clocked by `snapshotAt`. Without it the shared join newly writes
  an in-play price as opening on `NBA_2026-10-11_e401898400` (tip 10:00Z,
  snapshot 11:55:36Z, late 116 min), the only D1 row in that state.
- A row with no readable kickoff keeps HEAD's breadth: the resolved-key test
  only (no name-token test), straight orientation, exactly one candidate.
  Cup rows filed as MLS have no start_time and their own games are never in
  `soccer_usa_mls`; the token test would let a league fixture of the same
  clubs price them.
- The backfill SELECTs gain `start_time` only; their WHERE and the
  deliberately unguarded finality are unchanged. A row refused after kickoff
  is skipped like a miss, so a date with only such rows is marked tried, which
  is right: they never become pre-kickoff. Recorded in item 4 of
  `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md`.
- `JOIN_UNWRITABLE` gets an end date, the landing day, instead of being
  deleted: deleting it would count the pre-fix days' fetches as demand.
- Landing: after the 10-25 11:07Z demand read's dispatched run has finished
  and its log is on main (checked through the Actions API, not the clock),
  and before 2026-11-08: the CFL judging run checks `git log` on
  `src/index.js` from then.
- TASK 0 premises 4 and 5 (calls by sport and by trigger) need a per-call log
  line that does not exist; `fetchSportOddsLive` logs nothing. They were
  inputs to the (a)/(b) choice, which is made. The post-fix artifact is the
  D1 total below.

There are two shapes, and the owner picks between them:

- **(a) Make the join match.** For example, resolve the archive name through
  the identity resolver's alias table. Then the 30 credits buy a line.
- **(b) Do not fetch.** Skip a sport the join cannot serve. Its closing line
  already arrives from odds-backfill. This saves about 570 credits a week at
  October volume.

The choice covers all three `findOddsForRow` callers: the `/archive/game`
closing fetch, the opening-line cron, and the dead-hour
`runOddsBackfillForDate` (widened 2026-10-23). Under (b) the cron's skip goes
in its sport discovery. `runOddsBackfillForDate` also has item 4 of
`docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` (a refusal marks the
date tried); design the two together.

Either way, `JOIN_UNWRITABLE` is removed from
`scripts/measure-odds-consumer-demand.mjs` in the same change. The opening
snapshot's unwritable split (10-20: 9 sport-days vs 0 writable; 10-22: 12 vs
0) is used only as the before-measurement for done condition 4, under the
same removal rule. Model the dead-hour trigger only if premise 5 shows it
spends. No edit to that script before the 2026-10-25 11:07Z read, which
runs it.

## Built 2026-10-24, landed 2026-10-25 (Rule 74)

**Landed 2026-10-25.**
- **Unblock check passed.** Run 40187677225 (closing-capture run 2, log
  `outbox/odds-consumer-demand-20261025T110935Z.log`) had finished and its log
  for closed day 10-24 was on main.
- **Commits.** Rebased onto `origin/main` as `d46106b` (no opening line once its
  game has started) and `f4bea6a` (the per-team join).
  `JOIN_UNWRITABLE.until` was already `2026-10-26`, the first full UTC day after
  a deploy on 10-25, so nothing was amended. The demand script's self-test
  passes and its 21 mutations are caught.
- **Gates.** 134 of 136 deploy and guards steps on a clean worktree. The two
  failures are the environment-only ones: the BSD frame list fetch returned
  HTTP 0, and `RELAY_SHARED_SECRET` is unset in the sandbox.
  `check-commit-skip-prose` is clean.
- **Pushed 14:31:38Z**, inside the capture gap 14:30Z to 15:05Z (windows are
  T-10 minutes). Deploy RELAY Worker run 40202657716 succeeded at 14:38:06Z,
  Repo guards run 40202657752 and Workflow YAML Gate run 40202657785 too.
- **The staged patch is removed.**
- **Early read, 14:42Z:** no `odds_api` opening write since the deploy. The cron
  runs on the 15-minute journalism cycle, so this is not yet evidence either
  way; done condition 4 reads closed days.

The three paragraphs below are the state before the landing, kept as history.

**What was staged.** Two commits, kept local and saved as a patch until the
landing (the patch has since been removed):
1. `fix: no opening line is written once its game has started`: the cron and
   the worker backfill refuse a line captured at or after the row's kickoff,
   or the vendor's commence for a row without one.
2. `fix: one per-team join behind the three odds writers that match by name`:
   `src/odds-join.js`, the three callers hand it `start_time`, `JOIN_UNWRITABLE`
   gets its end date, G4 and G5 extended, the new harness
   `scripts/check-odds-join-shared.mjs` (19 scenarios, the real writers on
   node:sqlite) and its mutation harness (21 of 21).
Each passes every `deploy.yml` and `guards.yml` step but the two
environment-only ones on a clean clone.

**What blocks it.** The 2026-10-25 11:07Z demand read runs
`scripts/measure-odds-consumer-demand.mjs`, which commit 2 changes (owner
ruling: lands after that read).

**What unblocks it.** That read's dispatched `odds-consumer-demand.yml` run
has finished and its log for closed day 10-24 is on main (Actions API, not the
clock). Then: set `JOIN_UNWRITABLE.until` to the first full UTC day after the
deploy (the deploy run's completion day plus one), push in a gap between
AmbientDO capture windows, and before 2026-11-08 (the CFL judging run checks
`git log` on `src/index.js` from then).

**Verify after deploy** (done condition 4's queries): per sport, `odds_api`
opening writes above 0 on that sport's first closed day with rows; none
captured at or after kickoff; `archive_game_closing` for NFL or CFB above 0 on
a closed day.

**Decided in the build, from the adversarial review (workflow
`wf_ffee75ef-5a0`, every finding verified):**
- **Only as listed, not reversed.** Each row is decided alone, so a reversed
  match cannot see that another row owns the event. A split squad (the same
  clubs, the same instant, two cities; three NHL preseason pairs in the
  archive) had one listing price both rows, one of them from the other city's
  game. Reversed acceptance gained 1 row in 768 recorded pairs (Virginia v
  West Virginia, 09-19); the CI backfill's whole-slate matcher fills it.
- **The 90-minute window refuses an uncontested pair beyond it,** where
  `matchSlate` allows 720 when nothing contests the pair. The measured class
  is a CFB kickoff 130 minutes off the vendor's at a noon snapshot (LSU v
  Clemson). The CI backfill still fills those.
- **`until` is the first full UTC day after the deploy,** not the landing day
  as written above under "Design changes".

**Residuals, each with a home:**
- Comments that still describe the pair join (`src/index.js` about :15884 and
  :16082, `scripts/identity_ambiguity_conditions.py` ("to byPair.get before any payload is consulted"),
  `scripts/check-team-identity-collisions.mjs` (its header, "`byPair.get(resolveTeamKey(home) + '|' + resolveTeamKey(away))`")): added to
  `docs/CC-CMD-2026-10-23-odds-docs-stale.md`.
- The identity-ambiguity watch's same-slate collision count models rows that
  share resolved keys. The per-team join can also merge rows whose keys
  differ, by name tokens; only a payload can show that, and the census reads
  the archive alone. Recorded there too, as a measurement question.
- Two copies of the per-team rule (AmbientDO's `pick` and `odds-join.js`)
  differ on purpose: AmbientDO compares board full names and its rows always
  have a kickoff. Consolidating them is not needed for correctness.

## Done condition (Rule 90 artifacts)

1. TASK 0's five outputs committed.
2. **(a):** a test feeding the 19 real name pairs through `findOddsForRow`. It
   is red at HEAD and green after, with a mutation that restores the miss.
   **(b):** a check that the path makes no historical fetch for an unservable
   sport, with its mutation.
3. A per-consumer demand run whose fetchSportOddsHistorical "unwritable" line
   reads 0 credits, because the join now writes or the fetch is no longer made.
4. The opening-line cron: for each of NHL, NBA, CFB and NFL, on the first
   closed day after the deploy that has rows of that sport, `odds_api`
   opening writes are above 0 (only 3 of 22 October dates had all four
   sports, all Thursdays). And `fetchSportOddsLive` billed calls per day on
   the first full closed days after the deploy, from `odds_reconcile_state`,
   against the same weekdays of 10-14..10-23 (264-570 credits a day then).
   **Added:** no `odds_api` opening write captured at or after its row's
   kickoff since the deploy; `archive_game_closing` writes for NFL or CFB
   above 0 on a closed day, and at most that day's four-sport demand units.
   D1, with the ISO `ts` this writer uses:
   `SELECT substr(game_id,1,instr(game_id,'_')-1) lg, count(*) FROM change_log WHERE source='odds_api' AND field='opening_odds' AND substr(ts,1,10)='<D>' GROUP BY 1`.
