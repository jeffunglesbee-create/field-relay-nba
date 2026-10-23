# Claude Code Command — the closing capture buys before kickoff, writes to the right row, once per sport

**Date:** 2026-10-22
**Repo:** field-relay-nba (CONTRACTS.md copy in jubilant-bassoon)
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (real vendor spend with no output) and a data-semantics change ruled by the owner
**Confidence gate:** >= 95 before any commit
**Status:** DONE (2026-10-23). TASK 0 and TASK 1 DONE; done condition 3 met:
checked 5 of 5 soccer kickoffs on the ESPN-id path (probe run 40001556103),
after 12 of 12 NHL kickoffs on the name path the night before. Owner rulings
2026-10-22: "Repair the write fully now", then "Capture before kickoff".
**Absorbs:** `docs/CC-CMD-2026-10-22-closing-capture-buys-per-game.md` (one call per sport) and `docs/CC-CMD-2026-10-22-capture-record-keyed-by-source-id.md` (a failover id cannot buy twice once the row has its line).
**Blocks:** `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md` TASK 1, parked until this lands.

---

## TASK 0 — what was measured (2026-10-22)

Mapped by three readers and a critic (workflow `wf_dd351ddd-975`), each fact
with its command. Also checked here:

1. **The capture writes almost nothing.** `change_log` source
   `closing_odds_capture` has 14 writes in July, 29 in August, 1 in September and
   1 in October.
   - It finds its row by `r.id.includes(normName(home))`. Since about 09-01,
     archive ids are `<League>_<ET date>_e<espnEventId>`, with no team name.
   - The single October write went to the wrong row: the MLS skeleton
     `2026-10-17-mls-nyc-lafc` matched on the substring `lafc`.
   - In August, `rangers` contained `angers`, and a Ligue 1 line landed on an
     MLB row.
2. **The lookup date is the UTC day, but the archive dates rows by the ET day**
   (424 of 424). The lookup is also not scoped by sport, and its `LIMIT 50`
   was exceeded on 5 October dates.
3. **The trigger makes a correct write useless.**
   - The capture fires on pre→live, so every line is `_kickoff.verified:false`.
     The median is 2 min late; MLS runs about 12.
   - All five consumer sites skip `verified:false` (`selectLineOdds`) and fall
     back to `opening_odds`.
   - Both later writers write only `WHERE closing_odds IS NULL`:
     `archive_game_closing` at `src/index.js` about :13690, and
     `.github/scripts/odds-backfill.js:610`. So a late write also blocks the
     verified line they would supply. In 10-14..21 that was 65 of 66 lines in
     the eight sports the capture reaches.
   - This is why the owner ruled "capture before kickoff".
4. **Identity.**
   - ESPN boards (`espn:<n>`) carry `espnEventId`, and
     `(sport, date, espn_event_id)` is unique outside golf. That join matches
     90 of 90 rows in 10-14..21 and never touches the 48 MLS skeletons.
   - NHLE, NBA and secondary boards carry no ESPN id. Archive names there are
     nicknames ('Bruins'), so `resolveTeamKey` matches 0 of 29 NHL pairs, while
     `nameMatches(archive, board)` matches 29 of 29 uniquely.
   - Each board game's `league` equals the archive `sport` label.
   - NHLE and ESPN kickoffs differ by 15 min on 1 of 29 games, so kickoff is a
     tolerance, never an equality.
5. **Timing.**
   - A row exists before kickoff for 249 of 251 games. The seed runs from
     10:00Z on game day.
   - The board's `start` and the archive's `start_time` come from the same
     ESPN `comp.date`.
6. **Gates that pin the capture's shape** are listed in TASK 1 below. None of
   them scans `ambient-do.js` for identity or date.

## TASK 1 — build (owner-approved design)

1. **Trigger, in `_poll`.** A board game that reads `pre`, kicks off within the
   next `CAPTURE_LEAD_MS` (10 min), is not in the capture record, and belongs
   to a sport with an odds key goes into `pendingStarts`.
   - Each entry carries: gameId, sport, league, espnEventId, start, home, away.
   - The pre→live trigger is removed. A game first seen live, or one whose
     window was missed, is not bought: a late line blocks a better one.
2. **Check before buying, in `_closingRowsFor(sport, starts)`.** One SELECT per
   table for the sport, before any charge:
   - `sport = <league>`;
   - `date IN` the two possible ET days of each kickoff, which are its UTC day
     and the day before (no copied date helper);
   - `start_time IS NOT NULL AND closing_odds IS NULL`.

   A start matches a row whose kickoff is within `CONTESTED_KICKOFF_MINUTES`
   (90) of its own, and:
   - `espn_event_id` equality when the board game has one;
   - otherwise `nameMatches(row.home, board.home) && nameMatches(row.away,
     board.away)`.

   Exactly one row, or that start is not bought. A D1 error buys nothing.
3. **Record, then buy once per sport.**
   - The due games go into `_gameStarts` and `starts:today` (written before the
     vendor call; the output gate holds the call).
   - Then one charge and one `/odds` fetch for the sport.
4. **Vendor event.**
   - Only events whose `commence_time` is within 90 min of the board start.
   - Match by `resolveTeamKey` equality on board names, either orientation.
     Only if none matches, fall back to `nameMatches(board, vendor)`, which
     covers 'Columbus Crew' and 'Columbus Crew SC'. Two levels (Rule 76).
   - Exactly one event, or no write.
   - Prices are assigned by the team they belong to, so a swapped vendor
     orientation cannot exchange them.
5. **Write only a verified line.**
   - `stampKickoff(...)`. If `_kickoff.verified` is not true, do not write.
   - Otherwise `UPDATE … WHERE id = ? AND closing_odds IS NULL`, plus a
     `change_log` row with source `closing_odds_capture`. The name is
     unchanged, because `src/brief-freshness.js` whitelists it.
   - No `_oddsProof`: it would put the blob in `replayedRunClockSql`.
6. **Same commit:**
   - `scripts/check-closing-odds-kickoff-guard.mjs`: "reads start_time" accepts
     the wider SELECT, and a new assertion requires the verified-only write.
     Its mutation harness gets the new K10 anchor and K13 (writes a late line).
   - `src/odds-kickoff.js` header: AmbientDO no longer "writes, marked".
   - CONTRACTS.md, both repos: `closing_odds_capture` is pre-kickoff and
     verified, and a late capture is refused.
   - `scripts/check-ambient-capture-dedup.mjs`: moved to the new trigger.
   - New `scripts/check-ambient-capture-write.mjs`: the real
     `_closingRowsFor` and `_captureClosingOdds` against a fake ARCHIVE_DB and a
     fake vendor, with mutations. Both run in `deploy.yml`.

## TASK 1 — results (2026-10-22)

Landed in `e658b09` (relay) and `bee5fc7` (jubilant-bassoon CONTRACTS.md).
Deploy run 39822565693, green; the Cloudflare deploy step finished at
2026-10-22T17:29:59Z.

- **Built as designed, with one change from review.** Step 4's vendor match is
  per team, not per pair: each team matches by resolved key or by
  `nameMatches`. A pair where one team needs the resolver and the other needs
  the tokens (`Columbus Crew` and `Chicago Fire FC`) failed the per-pair form.
  Still two levels (Rule 76).
- **Two rounds of adversarial review.**
  - Round 1 found 15 issues, all fixed. The serious ones:
    - Overlapping polls (an alarm beside `POST /ambient/kick`) could buy twice.
      The record is now re-checked after the lookup's await, and `change_log`
      is written only when the UPDATE changed the row.
    - The close came from `bookmakers[0]` while the opening is DraftKings, so
      the gap between two books read as line movement. The close now prefers
      DraftKings (`CLOSING_PREFERRED_BOOK`, checked equal to
      `ODDS_PREFERRED_BOOK` by W20).
    - A row already past its own kickoff was still bought. The lookup now
      drops it with the shared `kickoffMark` before any charge (W8).
  - Round 2 found none. Its real-data replay of 10-17..21 matched 67 of 67
    board games to exactly one correct row and 14 of 14 vendor events, and a
    776-pair fixture gave 0 wrong-team writes.
- **Done condition 2: met.**

  | harness | checks | red at `90a72d1` | mutations caught |
  |---|---|---|---|
  | `check-ambient-capture-write.mjs` (new) | 25 | 18 | 29 of 29 |
  | `check-ambient-capture-dedup.mjs` | 32 | 15 | 32 of 32 |
  | `check-closing-odds-kickoff-guard.mjs` | 21 | 1 (the verified-only write) | 13 of 13 (K13 new) |

  Both capture harnesses run in `deploy.yml`, with `--mutate`. A clean-export
  run of the deploy.yml and guards.yml steps gave 127 of 131. The 4 failures
  are environment-only and fail identically at `90a72d1`.
- **Absorbed.** `docs/CC-CMD-2026-10-22-closing-capture-buys-per-game.md` and
  `docs/CC-CMD-2026-10-22-capture-record-keyed-by-source-id.md` are marked
  SUPERSEDED. The second one keeps a narrower residual, stated there.
- **Untested premises (Rule 100), not findings.**
  - A postponed game that the board maps to `pre` inside the window would be
    bought.
  - The World Series game espn:401908042 kicks off at 10-24T00:00Z, so its
    purchase lands at about 23:50Z on 10-23. A count by UTC day shows 6 calls
    on 10-23, not 5. Done condition 3 counts by kickoff.

## Done condition (Rule 90 artifacts)

1. TASK 0 committed (this document).
2. Both harnesses run in `deploy.yml`. Each is red at HEAD where the behaviour
   is new, green after, and every mutation is caught.
3. **Live.** After the deploy, the 10-23 kickoffs (Bundesliga 18:30Z, Serie A
   and Ligue 1 18:45Z, EPL and La Liga 19:00Z) give:
   - 5 or fewer `ambientCaptureClosingOdds` calls, one per sport and kickoff
     instant, each before its kickoff;
   - `change_log` `closing_odds_capture` rows on exactly the `_e<espnEventId>`
     rows of those games, each blob `_kickoff.verified:true`;
   - zero writes to rows with `start_time` NULL.

   Reported as "checked N of M kickoffs" (Rule 91).

### Done condition 3 — 2026-10-23: checked 5 of 5 kickoffs, all pass

D1 `cc49101c` (`change_log.ts` is `YYYY-MM-DD HH:MM:SS`, with a space):

```
SELECT c.game_id, c.ts, json_extract(c.new_value,'$._kickoff.verified') v,
       json_extract(c.new_value,'$.source') src, g.start_time,
       (g.closing_odds = c.new_value) same
FROM change_log c LEFT JOIN regular_season_games g ON g.id = c.game_id
WHERE c.source = 'closing_odds_capture'
  AND c.ts >= '2026-10-23 18:00' AND c.ts < '2026-10-23 19:30'
```

| game_id | ts | v | src | start_time | same |
|---|---|---|---|---|---|
| Bundesliga_2026-10-23_e401884761 | 18:20:20 | 1 | draftkings | 18:30Z | 1 |
| Serie A_2026-10-23_e401874957 | 18:35:07 | 1 | draftkings | 18:45Z | 1 |
| Ligue 1_2026-10-23_e401876428 | 18:35:07 | 1 | draftkings | 18:45Z | 1 |
| EPL_2026-10-23_e401879253 | 18:50:01 | 1 | draftkings | 19:00Z | 1 |
| La Liga_2026-10-23_e401882836 | 18:50:02 | 1 | draftkings | 19:00Z | 1 |

- **One row per kickoff,** each on exactly its `_e<espnEventId>` row (all 5
  rows existed before kickoff, `start_time` set, `closing_odds` empty), each
  verified, each equal to the row's `closing_odds`.
- **5 calls, each before its kickoff.** `outbox/ambient-capture-probe-20261023T181344Z.log`
  (run 40001556103, 18:13Z to 19:28Z, 144 readings): reconciled calls rose
  +1 at 18:20, +2 at 18:35 and +2 at 18:50, and not again. Serie A and Ligue 1
  are two sports, so two calls in one poll; so are EPL and La Liga.
- **Zero writes to a row without `start_time`:** 0 of the 17
  `closing_odds_capture` rows since 2026-10-22 17:30 (12 NHL on 10-22, these 5).
- **AmbientDO health over the window:** 52 instances seen (the restarts filed in
  `docs/CC-CMD-2026-10-22-ambient-do-restarts-on-every-event.md`), every one
  with `lastPutError` and `lastAlarmError` null; the capture record held across
  them (no second purchase).
- **The name path** was checked the night before:
  `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`, live checks 1 and
  2, 12 of 12 NHL kickoffs.
