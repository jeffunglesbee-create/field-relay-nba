# CC session — stage 1 pairs an MLB game with the same teams' next game, 2026-10-20

`docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md`, dispatched by the owner, who
ruled TASK 1 on 2026-10-19 and the claim check and TASK 2 on 2026-10-20.

**HEAD:** `30937338` → `6c8f4e7f`, `bb54fea7`, `95a94ec8`, `8cf7f818`, plus this
docs commit. Branch main throughout. The commits were rebased over two bot
commits before the push; `95a94ec8`'s message still names the pre-rebase SHAs
(`95760ec4..d6359a71`). Those are the same changes.
**Proof:** `outbox/odds-stage1-wrong-game-2026-10-20.log`
**Repair SQL as sent:** `outbox/odds-stage1-repair-2026-10-20.sql` (sha256 `908aa362…`)

## TASK 0 — premises, one command each (Rule 100)

| premise | command | result |
|---|---|---|
| one limit separates every right pair from every next-day pair | census, 776 rows, every sport | **true.** Right pairs reach −130, +121 and +235 min. Next-day pairs start at +1141. 720 refuses all 12 and none of the right ones |
| option (b) as written ("otherwise both are refused") is safe | section I on the 46 shared events | **false.** It would unprice the 86 MLS duplicate rows and the 3 correct doubleheader games. The owner was asked and chose "only the far twin" |
| `e401817035` is a postponement | ESPN game probe | **true.** `401817035` Postponed; `401923610` Final, BAL 4 TOR 2, the 09-23 makeup |
| both writers can see the archive kickoff | read the fill's SELECT; probe `/context/date` through the relay self-probe | **half.** The backfill's games carry `start_time`. The fill's SELECT did not, so it now selects it |
| a comment inside the fill's SQL is inert | the relay's `/d1/execute` table regex on that literal | **false.** "too far from the vendor's" reads as table `the` and returns 403. Found by the review, fixed before the push |
| the NULLed columns stay NULL | D1: odds_history rows per repaired game | **true.** Each of the 15 games had exactly 1 history row, the wrong one. Nothing is left for the sync to copy back |

## What landed

| commit | task | what |
|---|---|---|
| `6c8f4e7f` | 1 | `kickoffGapMinutes`, `KICKOFF_REFUSE_MINUTES` 720 (both stages), `CONTESTED_KICKOFF_MINUTES` 90 (stage-1 claim check); the fill selects `start_time`; both pairing lines print the refusals; check section I on the real census rows; M58-M66 |
| `bb54fea7` | 2 | `repair-odds-wrong-pairs.mjs --set=stage1`: 15 rows, generated and self-tested in SQLite, not applied |
| `95a94ec8` | 1 | the 11 review findings: the 403, claimants counted before any refusal, `unjudgedKickoff` and "kickoff judged on N of M", 7 new cases; M67-M76; four anchors re-set |
| `8cf7f818` | docs | the 2026-10-20 rulings and TASK 0-2 results in the CC-CMD |

## Done conditions (Rule 89)

1. **TASK 0's outputs, each with its denominator:** the CC-CMD's Results and
   proof log §5 (776 rows; 67 reproduced; 24 refused, 12 of them for the
   kickoff).
2. **Red before, green after, with mutations:**
   - the new checks against the base matcher: **23 FAILED**, all in section I;
     sections A-H, the existing cases, all pass on the base (§1);
   - at `8cf7f818`: all checks pass (§2);
   - `mutate-odds-matcher` 76 of 76 (§3); wiring check green (§4);
   - repair self-test 62 of 62 (§6), and its 12 stage-1 checks under
     mutation, 12 of 12 caught (§6b).
3. **TASK 2, owner ruling "NULL 5 blobs, delete 15 rows":**
   - **Read right before the write:** 15 games, 15 history rows and no others, 5
     columns written from them. Unchanged from the dry run.
   - **Applied** 2026-10-20 02:07:34Z, after the fixed code was on main.
     `outbox/odds-stage1-repair-2026-10-20.sql` (90 statements) was sent as ONE
     D1 call: 90 of 90 succeeded, change_log ids 22937 to 22956.
   - **change_log, 20 rows:** 5 NULLed closing_odds and 15 deleted history rows.
   - **D1 SELECT after the apply** (§7.3, all 15 games):
     - history rows 0 on all 15;
     - closing_odds NULL on `e401817001`, `002`, `004`, `035`, `907992`;
     - the other 10 closing blobs and all 15 opening blobs (other writers)
       unchanged.
   - **The scheduled read, 2026-10-20** (backfill run 39442651905 at `2631dd4e`, success,
     started 14:48:47Z; the 10:45Z check-in fired before it and was re-armed).
     - **PASS, the counters:** every pairing line carries the new fields, e.g.
       `2026-10-19 icehockey_nhl: 15 event(s), 6 out of window, 9 in pool -> 4 paired by name, 0 by elimination, 0 unmatched, 0 ambiguous, 0 refused because the unread side could not be that team, 0 refused for a kickoff too far off, 0 refused as a shared event's far twin; kickoff judged on 4 of 4 pairs`.
       The same holds on all 7 lines (NHL, MLB, WNBA, EPL, La Liga, Serie A, NFL).
     - **PASS, the repair holds:** the 15 deleted history rows are still absent,
       and the 5 NULLed closing_odds are still NULL.
4. **Deploy:** run 39357014311 (Deploy RELAY Worker) on `8cf7f818`, success.
   It carries every code change. Repo guards run 39357014287, also success.
   Before the push, every `run:` step of deploy.yml (up to the Cloudflare
   deploy) and of guards.yml ran on a clean copy of the code: 125 of 130 pass
   at `8cf7f818`, and 125 of 130 at base `30937338`; failing only at HEAD: 0.
   The 5 failures print their own cause: Cloudflare credentials (3 KV
   bootstraps), the network (`HTTP 0`), and an unset `RELAY_SHARED_SECRET`.
   All 5 pass on the runner (proof log §8).

## What this session got wrong, and the cost

- **A SQL comment would have broken the fill.** The relay guard takes the first
  word after `FROM` as the table name. A comment containing "far from the"
  would have made every fill's games query a 403. The review caught it. The
  wiring check now applies the guard's own regex, read from `src/index.js`, to
  every SQL literal the fill sends (M75).
- **The claim count missed refused claimants.** A twin refused by the 720 rule
  was not counted, so its far rival kept the event alone. Fixed: claimants
  are counted before any refusal (M72).
- **The header claimed a count that did not exist** (Rule 91). It said missing
  kickoffs were counted; no counter existed. `unjudgedKickoff` now does, and
  both lines print it: 50 of the 776 census rows are unjudged.
- **Four mutations went NOT APPLIED** after the review's code changes moved
  their anchors (M59, M60, M62, M63). The harness reported them instead of
  passing them, and they were re-anchored.
- **The repair's stage-1 checks had not been mutated before the write.** Stage
  2's had (R1-R8). The 12 stage-1 checks were mutated after the apply (§6b),
  12 of 12 caught. The SQL that was sent is the one those checks pass on.

## Limits, printed with the result (Rule 91)

- **The kickoff rules are measured on the census:** 776 rows since 2026-09-16,
  each pair on its own reduced slate, plus the 46 shared events on slates
  holding every claimant. A full live payload has not been run through them.
- **50 of 776 pairs have no archive kickoff** and are not judged. Every pairing
  line now prints that count.
- **720 and 90 come from one month of one season.** A doubleheader 90 minutes
  or less apart would keep both games on one event. None is in the census.
- **The census reproduces each row alone,** so the 3 doubleheader twins show
  `PAIRED stage 1` there. The claim check is proven in section I, where both
  games share a slate.

## Integration state (Rule 65)

- **Relay contract:** unchanged. `src/odds-name-match.js` is not imported by
  `src/index.js`, so the worker's behaviour is unchanged.
- **Client consumers:** unaffected.
- **Behaviour changes, both in CI-run scripts:**
  - **the odds-backfill workflow:** refuses a pair more than 720 min off and a
    shared event's far twin; prints both counts and "kickoff judged on N of M
    pairs";
  - **targeted-odds-fill:** the same, and its games SELECT now carries
    `start_time`. The seed parser still reads its pairing line (tested).
- **change_log:** the 20 rows carry `consumed = 0`, as stage 2's 23 do. Their
  only reader is `getRecentChanges` (`src/sync-reconciler.js`).
