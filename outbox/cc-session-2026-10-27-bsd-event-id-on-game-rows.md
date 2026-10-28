# Session 2026-10-27/28 — `bsd_event_id` on archived soccer game rows

CC-CMD: `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md` (filed `a9a87ac`). Consumer:
field-laboratory `docs/CC-CMD-2026-10-27-lineups-on-game-cards.md`, now UNBLOCKED.
HEAD progression: `cd09ad0` at probe time → `715c7d4` (first push, red) → `b8d83b4` (fixes, green, live verified).

## Result

A soccer game row served by `/context/date/{date}` now carries `bsd_event_id`, the id
`/bsd/events/{id}/lineups` takes. Measured on the DEPLOYED relay by a runner (`bsd-game-join-verify`, run
40608452953 on `8d51a11`, record commit `d180135`, first-run copy kept at
`outbox/bsd-game-join-live-2026-10-28T0023Z-first-run.json`, committed `bd39545`):

| date | soccer rows | joined | written, first call | written, second call |
|---|---|---|---|---|
| 2026-08-29 | 43 | 43 | 43 | 0 |
| 2026-09-05 | 41 | 41 | 41 | 0 |

- 11 of 11 assertions pass. Coverage line in the artifact: `2 dates, 197 context rows read, 84 soccer rows, 84 carrying an id`.
- Oracle: 9 of 12 pinned row ids are present in the live archive and all 9 carry their fixed event id (0 wrong).
  Absent, named by the artifact: `2026-08-29-mls-min-orl`, `2026-08-29-mls-skc-van`, `2026-08-29-mls-hou-sj`.
- Kickoff: 71 rows judged, 0 more than 180 minutes from their event; 13 rows have no `start_time` and are
  UNJUDGED and counted, not passed (8 on 08-29, 5 on 09-05).
- 0 of 113 non-soccer rows carry an id. Key set of every served row = the fixture's 25 columns + `bsd_event_id`.
- Idempotence, twice: the second call inside run 40608452953 wrote 0, and a separate dispatch at 00:24:19Z
  (record `40ce12b`) wrote 0 on its FIRST call (`pending 0`) with 43 of 43 and 41 of 41 still joined.
- Read independently of the relay: `SELECT ... FROM change_log WHERE source='bsd_game_join'` on ARCHIVE_DB
  returned 84 rows, 84 distinct games, all between 00:23:41Z and 00:23:47Z (the admin run); `bsd_event_id` is
  non-null on 84 `regular_season_games` rows (dates 2026-08-29, 2026-09-05), 0 on `postseason_games`, 0 on any
  non-soccer sport. The rerun added no change_log rows.

Deploy: Deploy RELAY Worker run **40607238843**, success, on `04d28bd`.

## Commits (field-relay-nba main unless noted)

| commit | what |
|---|---|
| `a9a87ac` | the CC-CMD |
| `bd8ba9e`, `1298fda`, `59a44c8` | fixture capture workflow; it refuses a non-page BSD answer; the fixture (84 soccer rows, 973 events, both UTC days) |
| `7191291` | 29 BSD club names into `identity-resolver.js` (28 BSD forms + `Athletic`) |
| `fcf5bb9` | `src/bsd-game-join.js` and `scripts/check-bsd-game-join.mjs` (20 checks) |
| `4c15496` | column, `runBsdGameJoinForDate`, `POST /admin/bsd-game-join`, once-per-day pass, CONTRACTS.md section, deploy.yml step |
| `1d49b7b`, `715c7d4` | the live check and its workflow, failed on purpose against a stub (8 of 8 modes); absence-ratchet fix |
| `067d74c`, `a238f5e`, `f45ca86`, `04d28bd` | the three repairs below, and the merge of a bot's drift log |
| `8d51a11`, `d180135`, `40ce12b`, `bd39545` | trigger, first record, rerun record, first-run copy |
| jubilant-bassoon `657eb070` | CONTRACTS.md synced, byte-identical (sha256 `86cce0913d27ae8e`) |

## Task 0 answers

- Hook: the "Odds snapshot (opening_odds)" block (`snapshotCronOdds`) in `handleJournalismCycle`, the existing
  `*/15` cron. No cron change. The pass handles one date per tick of dates today−1..today+3, a KV done marker
  per date per UTC day (36 h), a failure marker (1 h), at most 24 upstream pages per run, inside its own try/catch.
- Admin auth: `relaySecretMatches(request.headers.get('X-FIELD-Relay'), env)`, fail-closed (an unset
  `RELAY_SHARED_SECRET` matches nothing).
- BSD rate limit: none documented; probes show no RateLimit headers. The join reads through the same cache key
  `/bsd/events/by-date` uses, so a cache hit costs no upstream call (first run: 10 and 12 upstream pages, 0 cache hits).

## Aliases and mutations

- 29 alias pairs; 1,550 names probed before and after; exactly 29 keys changed, each an added variant. Collision
  checks 0 silent, 1 recorded; 43 of 43 ambiguity assertions; 10 identity-importing checks exit the same.
  `Athletic` maps to the existing canonical `Athletic Club` instead of replacing it (the first attempt silently
  overwrote it; the collision check found it).
- Mutations: 7 of 7 on the join rule, 9 of 9 on the wiring (16), each harness asserting its anchor unique and
  applied. Live check stub: 8 of 8 modes turn the right assertion red. Wiring check: 13 of 13.

## Corrections to the CC-CMD as filed

1. Done condition 2 said 12 of 12 oracle pairs. Only 9 of the 12 row ids exist in the live archive; the artifact
   names the other 3. The measurable claim is 9 of 9 present, correct.
2. The synthetic case S3 (same teams, a day later) is `ambiguous`, not "refused": kickoff never chooses between
   candidates, it only refuses (owner ruling 2026-10-19).
3. The archive holds duplicate rows of one fixture under two id schemes (`MLS_<date>_e<espn id>` and
   `<date>-mls-xxx-yyy`). Both carry the one event id: 11 events are shared by two rows. Correct for this field;
   the duplication is the archive's own problem.

## Defects of mine in this work

- `715c7d4` went red on three gates. (a) Repo guards: my admin route read its body with
  `request.json().catch(() => null)`, a bare empty catch; 113 against a baseline of 112. Now a 400 naming the parse
  error (`067d74c`), with a wiring check and mutation W9. (b) Deploy: `check-coverage-states.mjs` asserted the vendor
  reports an in-season, unpriced sport TODAY. After the 10-26 probe that read none (darts priced, CS2
  `no_fixtures`), so the first deploy after it failed before reaching any step touching my code. A latent gate
  defect, not caused by this work, and a deploy gated on a vendor's daily state. Replaced (`a238f5e`) by dated
  evidence (`outbox/bsd-coverage-third-state-evidence.json`: the 10-12 and 10-19 readings, 4 of 4 rows) that the
  classifier still calls the third state; today's count is printed, not asserted. Five mutations of it, each caught.
  (c) The CONTRACTS identity check: the client copy lacked the new section; synced in both repos.
- The Task 1 push `bd8ba9e` had already turned Repo guards red (run 40600013414, the absence-collapse ratchet, 205
  against 204); three sites tripped it in turn (capture script, `fetchBsdEventsForDay`, the live stub).
- Mutation harness gaps found and closed: W8 survived until the wiring check was tightened; the live stub's
  `dropColumn` mode could not fail until the check compared each row's key set; W6's anchor ran through a line I
  edited and the harness refused ("matched 0 times, NOTHING WAS MUTATED"), which is the harness working.
- Before the fix push, deploy.yml steps 4–107 were run locally: 98 of 100 passed; the other 2 refuse a dirty
  `src/index.js` and passed once committed. Steps after 107 need the network or secrets and were not run locally.

## What this does not prove (Rule 91)

- Two dates, 84 soccer rows, all six labels but only MLS rows in the oracle; no UEFA competition was in either
  date. Not a season.
- "Every joined row names the teams of its event, in order" uses the join's own resolver, so it is not independent
  of it. The 9 oracle pairs, fixed by the laboratory from the BSD payload by exact name, are the independent check.
- 13 rows have no `start_time`; their kickoff was not judged.
- The once-per-day pass was exercised offline (wiring check, mock `env`) and, below, live. Read 2026-10-28T01:35Z
  from ARCHIVE_DB with no admin call involved: `change_log` rows with source `bsd_game_join` appear at 00:30:34Z,
  00:45:53Z, 01:00:55Z and 01:15:34Z, the `*/15` cron minutes, after the 00:23Z admin run (84 rows). One date per
  tick, ascending, as `runBsdGameJoinWindow` is written (window `dateKey-1 .. +3`, `dateKey` 2026-10-27 at 00:30Z):

  | date | soccer rows | with id | written at |
  |---|---|---|---|
  | 2026-10-26 | 3 | 3 | 00:30Z tick |
  | 2026-10-27 | 3 | 3 | 00:45Z tick |
  | 2026-10-28 | 14 | 14 | 01:00Z tick |
  | 2026-10-29 | 9 | 9 | 01:15Z tick |
  | 2026-10-30 | 0 rows | | (the 01:30Z tick) |

  113 rows now carry an id (84 admin + 29 cron); 0 on `postseason_games`; 0 on any non-soccer sport. My 00:25Z
  baseline of "0 of 41 rows dated 10-27..10-31" used the wrong window: `dateKey` is the cron's date key, so the
  window at that hour was 10-26..10-30.
- A measured boundary, not a defect: dates outside the rolling window are not touched by the cron. 2026-10-25
  (30 soccer rows), 2026-10-31 (15) and 2026-11-01 (5) carry no id; 10-31 and 11-01 enter the window as `dateKey`
  advances. Any older date is joined only if someone calls `POST /admin/bsd-game-join` for it (the route takes one
  date per call). A card for a game on such a date shows `not-joined`.

## Residual

None deferred. The boundary above (dates before the rolling window are joined only on request) is stated, not a gap in this CC-CMD's done condition.
