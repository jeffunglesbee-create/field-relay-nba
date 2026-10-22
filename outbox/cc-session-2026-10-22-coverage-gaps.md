# CC session — AmbientDO polls NBA/NHL from October and reads the ET slate (2026-10-22)

`docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`, resumed by the owner
("resume coverage gaps now") after the before-kickoff capture (`e658b09`).
**Status:** TASK 0 and TASK 1 DONE; done condition 3 STAGED until tonight's NHL
kickoffs and the 10-24 demand read.

**HEAD:** `5cf8e2d` → `4dbb578` … `c47aaf0` (pushed 19:10Z) → this close-out.
Branch main throughout. jubilant-bassoon: `3b8ae577` → `3e489fd5`.

## What landed

| commit | what |
|---|---|
| `4dbb578` | G4: `/v2/games` skips the NHL and NBA brief enqueue for AmbientDO's poll (`X-Ambient-Internal: 1`). `scripts/check-v2-games-ambient-no-briefs.mjs` runs the real worker |
| `86363b7` | G2: `getFieldDateKey()` steps back a calendar day before 4am ET; moved to `src/field-date.js`. `scripts/check-field-date-key.mjs` |
| `b04f007` | Gap 2: AmbientDO asks for the slate date's board and takes the season month from it |
| `8564f5b` | Gap 1: NBA and NHL polled October to December |
| `640dccd` | Filed `docs/CC-CMD-2026-10-22-ambient-stale-live-after-failover.md` (TASK 1's third item, not built) |
| `10a30a6` | The 2026-10-22 odds watches daily read (scheduled task), and `docs/CC-CMD-2026-10-22-dead-cron-watch-one-empty-read.md` |
| `bea0f42` | Second review: harness checks per poll, at spring-forward, inside the EST hold |
| `515d329` | Second review: per-run mutant files, `.mutant-*` ignored |
| `c47aaf0` | Filed `docs/CC-CMD-2026-10-22-journalism-game-route-prefixed-ids.md` |
| jubilant-bassoon `3e489fd5` | `TODAY_ISO` steps back a calendar day the same way (`fieldTodayIso`), SW 2026-10-22a |
| this close-out | CC-CMD TASK 1 results and status, the parked patch removed, this doc, HANDOFF |

## Verification

| check | result |
|---|---|
| `check-v2-games-ambient-no-briefs.mjs` | 7 checks, 2 red before, 6 of 6 mutations |
| `check-field-date-key.mjs` | 21 instants and a 43,872-instant sweep; the old body fails at 2027-03-15T04:00-04:45Z only; 6 of 6 mutations |
| `check-ambient-capture-dedup.mjs` | S15-S19 new (S15-S18 red before); 46 of 46 mutations |
| `check-ambient-capture-write.mjs` | unchanged, 29 of 29 mutations |
| deploy.yml and guards.yml steps, clean clone | 131 of 133; the 2 failures need a secret or a GitHub list call, and fail the same at the base |
| Adversarial review | 5 lenses; runtime and spend found nothing. 9 findings: 7 fixed, 1 refuted 3 of 3 with its narrow part filed, 1 refuted 3 of 3 |
| Relay deploy | run 39837727213 green, Cloudflare 19:15:43Z; Repo guards green |
| Live, first reading | the stored AmbientDO scores went from 4 entries (17:41Z) to 16 after the deploy, which fits the 12 NHL games of 10-22 added. Inferred, not itemised: the diag view does not list sports |

## Integration state (Rule 65)

- **Relay contract:** unchanged in shape. `closing_odds_capture` blobs now
  also land on NHL rows (`NHL_<ET date>_e<id>`), and on kickoffs from 00:10Z to
  04:00Z (EDT) or 05:00Z (EST).
- **Client:** `window.TODAY_ISO` and the relay's slate date agree at every
  instant.
- **Status:** STAGED. Blocked by: the first NHL kickoffs after the deploy
  (23:00Z). Unblocked by: tonight's 12 NHL kickoffs. Verify:
  - `SELECT c.game_id, c.ts, json_extract(c.new_value,'$._kickoff.verified') v, g.start_time FROM change_log c JOIN regular_season_games g ON g.id=c.game_id WHERE c.source='closing_odds_capture' AND c.ts >= '2026-10-22 19:15'`
    gives one row per NHL kickoff, v = 1, ts before start_time;
  - `odds_budget_site` `ambientCaptureClosingOdds` grows by 3 per kickoff time
    (5 kickoff times tonight, 15 credits).
  - Scheduled: 23:42Z (trig_01Y2UqJEaS6sGzjCxrweAHF7) and 02:20Z
    (trig_0151JCfzHR9ForV2Jtv3xszR); done condition 3 at 10-24 11:07Z
    (trig_01L6WecMnwmnwZzL4iAu1VTn).
- **Known mismatches:** none.

## Spend

About 3 credits per NHL kickoff time, about 90 a week (TASK 0.3), only for
games whose archive row still needs a line. NBA costs nothing while its board
answers 403. No new LLM spend: AmbientDO's poll starts no briefs.

## Open items, each filed

- `docs/CC-CMD-2026-10-22-ambient-stale-live-after-failover.md`
- `docs/CC-CMD-2026-10-22-journalism-game-route-prefixed-ids.md`
- `docs/CC-CMD-2026-10-22-dead-cron-watch-one-empty-read.md`
- `docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md` (NBA captures wait on it)
