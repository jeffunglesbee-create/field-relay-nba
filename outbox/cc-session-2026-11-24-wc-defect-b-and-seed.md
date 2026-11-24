# CC session 2026-11-24 — WC Defect B (knockout games filed as group rows) and the admin-seed ReferenceError, fixed; the production cleanup is staged for the owner

**Task:** the scheduled follow-up `trig_01QnrMSPjGZfAkL8HJKLc9BH` ("Start WC-table Defect B and the seed fix", fired 2026-11-24T15:00Z), after the CFL judge's verdict
was recorded (`outbox/odds-cfl-season-end-judgment-2026-11-24.md`, pushed 14:42Z), which lifted the `src/index.js` window.
**Spec and result:** `docs/CC-CMD-2026-11-07-wc-results-club-contamination.md` (Defect B, Task 3b and "Also found" are the full record). **Result:** Defects B and the seed fix
DONE in code with checks; the production writes (Task 3 and 3b) are STAGED for the owner.

## HEAD progression (field-relay-nba, branch `main`)

`8234c85` (start) -> `9f25a2f` Defect B (code, check, deploy.yml step, CC-CMD) -> `23cddc5` the seed fix (code, check, deploy.yml step, CC-CMD) -> this session doc and
the HANDOFF close-out (the next commit). No credits, no odds route. The `*/15` journalism cron is not touched.

## What was built, per commit

- **`9f25a2f`, `src/index.js`:** `extractWCGroup(round)` reads the group from the round string alone, returns null for a round that names a knockout phase, and has no
  team-name fallback (`_WC_TEAM_GROUP` deleted, no other reader). `extractWCPhase` matches `3rd[\s-]+place`. The BSD enrichment no longer lets `group_name` replace a
  knockout round. The dead-hours sweep re-writes a group row under the stored group (`round: \`Group ${g.group_id}\``) and loses its derived-group cross-check.
  `scripts/check-wc-knockout-not-group.mjs` (45 requests against the real worker; red on the unfixed source in 13 cases; 27 of 27 mutants) in `deploy.yml`.
- **`23cddc5`, `src/index.js`:** `bsd_event_id` is destructured in `handleWCAdminSeed`. `scripts/check-wc-admin-seed.mjs` (9 requests; red in 6 cases; 17 of 17 mutants) in `deploy.yml`.

## Task 0, and what it overturned (Rule 100)

The real round strings were read through the relay first (`/v2/games?sport=wc26`, 9 dates): the third-place game is `FIFA World Cup, 3rd-Place Match`, which the old code
could not read. D1 then refuted two premises of the CC-CMD: only **10** knockout games are filed as group (not 66; two of the twelve group rows after 06-27 are real
group-J games dated 06-28 UTC), and the surplus over 72 is mostly **56 duplicate legacy rows** (`football:` and `manual:` ids, every one with an `espn:` twin). The cause of
the nine Round of 32 misfiles stays INFERRED (the round at write time is not stored); the record says what contradicts it (two r32 rows filed right under the same adapter).

**A side effect to know about.** Reading `/v2/games` for a past date runs the request-triggered result writer, so this session's Task 0 reads wrote to production. `wc_results`: one
new row, `espn:760488` (r32, Netherlands 1-1 Morocco, correct content, created 15:01:31Z), and equal-value re-writes of rows that existed. `ARCHIVE_DB.briefs`: 6 `bracket_delta`
rows (BracketDO, 15:12 to 15:20Z) and one Haiku `game_recap` (`espn:760484`, 15:13Z); attribution is inferred from the code and the timestamps. Each BracketDO recompute fetches
`/wc/odds-probs`; the ledger shows 0 credits for it on 11-24. So: no credits spent, and no odds route called directly. The CC-CMD's own Task 0 prescribed the read; it is now
recorded there as a write.

## Verified, and how

- The two new checks: self-test, `--mutate`, and red against `origin/main`'s `src/index.js` through `INDEX_MODULE` (10 and 5 failing cases). Hermetic (no network, any clock).
- The WC-table check from Defect A (`check-wc-tables-world-cup-only.mjs`, 11 mutants) still passes.
- **Two independent reviews (four read-only reviewers before the first commit, two after the fixes).** Fixed from the first: the seed check was not wired into `deploy.yml` (a blocker); a wrong-bearer
  case; twelve group letters instead of four; a strict stub (no statement of any kind, no D1 member beyond `prepare`); full bind lists; a live case for all six knockout strings; the BSD path
  (reproduced, now guarded); two `bsd_event_id` values and Bosnia's spelling added to the cleanup; five wrong or overclaiming sentences in the CC-CMD (a row created by this session's own probe
  was cited as a June row). Fixed from the second: the seed check could not see statement ORDER (a backfill before the REPLACE, a recompute before the row), a zero score, an unbound secret, or a
  missing field; the knockout check read only 7 of 8 binds and no UPDATE, and its "rejected work" term could never fire (the worker wraps its writers in `Promise.allSettled`, which is now watched);
  the sweep's tried marker was never exercised; the side-effect account omitted the `ARCHIVE_DB` writes; a mutant count (Defect A's 8, really 11); a KV TTL (movers is 1 day); a claim that
  `/wc/bracket/refresh` spends credits (the ledger shows 0 net since 2026-09-22); the heading's clock time.
- The pre-deploy gates of `deploy.yml` and the push-time gates of `guards.yml`, run in a clean clone named `field-relay-nba` at the final commit: the counts are in the HANDOFF entry's last bullet.

## STAGED: the production cleanup (Task 3 and Task 3b)

- **What:** reclassify 10 rows, update 2 `bsd_event_id` values, optionally normalise Bosnia's spelling, delete 56 duplicate legacy rows and 61 club rows, rebuild `wc_group` (48 rows).
  The literal SQL and the previews are in the CC-CMD, "Task 3b".
- **Blocked by:** the owner's approval (a production write). **Unblocked when:** the owner answers the question asked at the end of this session.
- **Verify when done:** the four statements under "Done condition" in the CC-CMD (no row with a group size other than 4; 72 group rows; 0 rows outside the tournament's dates; the phase counts).
- Not reached by those writes (owner decisions): BracketDO's stored snapshot, the ten group-framed `game_recap` briefs, and the order in which `/wc/projections` is first hit.

## Not verified

- What the round string was when each of the nine Round of 32 rows was written.
- Whether any 2026 group game lacked a letter in both ESPN's and BSD's strings (ESPN is 403 from the sandbox); 12 of 72 group games were read through the relay, all with a letter.
- How the client renders group B after the cleanup (Bosnia's spelling).
- The deploy result of this push (a later HANDOFF Update bullet, once the run has finished).
