# CC session — the closing capture buys before kickoff, for the right row (2026-10-22)

`docs/CC-CMD-2026-10-22-closing-capture-before-kickoff.md`. The owner
dispatched "next approved" (the coverage-gaps spend). Three rulings followed:
"Fix per-game buying first", "Repair the write fully now", "Capture before
kickoff". **Status:** TASK 0 and TASK 1 DONE. Done condition 3 is STAGED until
the 10-23 18:30Z..19:00Z kickoffs.

**HEAD:** `b0e85b8` → `892d841` (coverage-gaps TASK 0, NBA CDN 403 filed) →
`90a72d1` (this CC-CMD filed) → `e658b09` (the fix) → this close-out. Branch
main throughout. jubilant-bassoon: `bee5fc7` (CONTRACTS.md copy), on main.

## What landed

| commit | what |
|---|---|
| `892d841` | Coverage-gaps TASK 0 results. Filed `docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md` |
| `90a72d1` | This CC-CMD: TASK 0 facts, the owner-approved design, done conditions |
| `e658b09` | The fix in `src/ambient-do.js`. New `scripts/check-ambient-capture-write.mjs`; the dedup harness moved to the new trigger; the kickoff guard and its mutation harness; `check-odds-calls-guarded.mjs` excludes the new harness by name; empty-catch pin 332 → 342 in `deploy.yml` and `guards.yml`; `src/odds-kickoff.js` header; CONTRACTS.md |
| jubilant-bassoon `bee5fc7` | CONTRACTS.md copy, byte-identical to the relay's |
| this close-out | TASK 1 results, the two absorbed CC-CMDs marked SUPERSEDED, the scheduled checks rewritten, this doc, HANDOFF |

## What TASK 0 found

- `change_log` source `closing_odds_capture`: 14 writes in July, 29 in August,
  1 in September, 1 in October. The October one landed on the MLS skeleton
  `2026-10-17-mls-nyc-lafc` by the substring `lafc`.
- Cause: the row was found by a team name inside the id, and ids have been
  `<League>_<ET date>_e<espnEventId>` since about 09-01. The lookup used the
  UTC day against ET-dated rows, was not scoped by sport, and its `LIMIT 50`
  overflowed on 5 October dates.
- The pre→live trigger made every line `_kickoff.verified:false` (median 2 min
  late). All five consumers skip those lines, and the two later writers only
  fill `closing_odds IS NULL`, so a late capture blocked 65 of 66 verified
  lines in 10-14..21.

## What changed (TASK 1)

1. Trigger: a board game still `pre` within 10 minutes of kickoff, with an
   odds key, not already in the capture record.
2. Lookup before any charge: one SELECT per table, scoped by league, the two
   possible ET days, `start_time` set, `closing_odds IS NULL`. Match by ESPN
   event id, else both names; within 90 minutes; still before the row's
   kickoff; exactly one row.
3. One charged call per sport per poll. The record is re-checked after the
   lookup's await.
4. Vendor event within 90 minutes, each team by resolved key or name tokens,
   either orientation, exactly one. DraftKings when listed.
5. Written only when `_kickoff.verified` is true; `change_log` only when the
   UPDATE changed the row.

## Verification

| check | result |
|---|---|
| `check-ambient-capture-write.mjs` | 25 checks; 18 red at `90a72d1`, all green after; 29 of 29 mutations caught |
| `check-ambient-capture-dedup.mjs` | 32 checks; 15 red at `90a72d1`; 32 of 32 mutations caught |
| `check-closing-odds-kickoff-guard.mjs` | 21 of 21; its mutation harness catches 13 of 13 (K13 new: a late line written) |
| deploy.yml and guards.yml steps, clean export | 127 of 131. The 4 failures are environment-only and fail identically at `90a72d1` |
| Adversarial review, round 1 | 15 findings, all fixed: a double purchase under overlapping polls, a FanDuel close beside a DraftKings opening, rows already past kickoff bought, a date-blind fake relay, and harness gaps |
| Adversarial review, round 2 | 0 findings. Real-data replay of 10-17..21: 67 of 67 board games matched exactly one correct row; 14 of 14 vendor events matched; a 776-pair fixture gave 0 wrong-team writes |
| Deploy | run 39822565693 green, Cloudflare deploy 17:29:59Z. Repo guards green. CONTRACTS.md identity: green in jubilant-bassoon (39822869645); the relay-side run on the push went red because it ran before the client copy landed, and the re-dispatch 39823218852 is green |

## Integration state (Rule 65)

- **Relay contract.** `closing_odds` blob from `closing_odds_capture`:
  `{source, captured_at, moneyline{home, away[, draw]}, spread?, total?{over, under}, _kickoff{verified:true, ...}}`.
  No `_oddsProof`. Written only on the matched `_e<eid>` row.
- **Consumers.** Unchanged: `selectLineOdds` and `knownPostKickoff` read
  `_kickoff.verified`. A verified capture is now used where before it was
  skipped.
- **Status.** STAGED. Verify on the 10-23 kickoffs: Bundesliga espn:401884761
  18:30Z; Serie A espn:401874957 and Ligue 1 espn:401876428 18:45Z; EPL
  espn:401879253 and La Liga espn:401882836 19:00Z. Blocked by: no kickoff of a
  sport AmbientDO polls with an odds key before then (the 14 remaining 10-22
  kickoffs are NBA and NHL, not polled in October). Unblocked by: those
  kickoffs. Verify:
  - `ambient-capture-probe.yml` minutes=75 from 18:12Z: at most 5 rises of
    `ambientCaptureClosingOdds` reconciled calls, each in the 10 minutes
    before its kickoff.
  - D1 `cc49101c`: `SELECT c.game_id, c.ts, json_extract(c.new_value,'$._kickoff.verified') v FROM change_log c WHERE c.source='closing_odds_capture' AND c.ts >= '2026-10-23 18:00'`
    gives one row per kickoff above, on `_e<eid>`, `v = 1`.
  - Scheduled: trig_011xqk7EcLqic7NyH583g2KT at 2026-10-23T18:12Z.
- **Known mismatches.** None in field names.

## Open items, each filed

- Coverage gaps (NBA/NHL in October, the UTC board): parked in
  `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`, resumes on top of
  `e658b09`.
- AmbientDO restarts: `docs/CC-CMD-2026-10-22-ambient-do-restarts-on-every-event.md`.
- NBA CDN 403 in season: `docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md`.
- `docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md` done
  condition 3: scheduled 10-24 and 10-25 11:07Z.

Untested premises, reported as such (Rule 100):

- A postponed game the board maps to `pre` inside the window would be bought.
- The World Series game espn:401908042 kicks off 10-24T00:00Z, so its purchase
  lands at about 23:50Z on 10-23. A count by UTC day of 10-23 shows 6 calls,
  not 5.
