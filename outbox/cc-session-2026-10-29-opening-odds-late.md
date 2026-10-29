# Session 2026-10-29 (evening) — "opened" lines skip an opening captured after kickoff (CFB Saturday CC-CMD, TASK A2)

Spec: `docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md`, TASK A2. Owner approval: "cfb Saturday approved" (2026-10-29).

## HEAD progression

| repo | from | to |
|---|---|---|
| field-relay-nba | `a09d739` | `66a61d2` |
| jubilant-bassoon | `8044a686` | `26ee3239` (SW 2026-10-29b) (SW 2026-10-29b) |

## What was built

**Relay (`66a61d2`).** `knownLateOpening`, `debriefOddsLine`, `openingOddsParts` in `src/odds-consumer-rules.js`; `computeOddsStory`
returns `''` for a late opening; five sites in `src/index.js` call the helpers (both debrief blocks, `buildBackfillPrompt`, the slate
annotation loop) and `findGame`'s `lineMovement` is not built from a late opening. Stored data and response shapes unchanged.

**Client (`26ee3239` (SW 2026-10-29b)).** `_openingCapturedLate` in `src/debrief/index.ts`; `buildOddsStory` and `buildOddsMovement` return nothing
for a late opening. `CONTRACTS.md` records the opening-line rule (relay copy synced).

## Premises refuted before building (Rule 100)

1. The predicate. `verified: false` is also written for a kickoff nobody could read (`late_minutes` null); one real MLS row. The
   predicate is a finite `late_minutes`.
2. The census. It listed eleven readers; `findGame`'s `lineMovement` was a twelfth. Of the client's three readers, two have no feed:
   `/archive/query` reads the `briefs` table and no `/archive/upsets` route exists, so `_isUpset` and the market-consensus functions
   never receive an `opening_odds` (probed `/archive/query?limit=3` on 2026-10-29). The live client readers are `buildOddsStory`
   and `buildOddsMovement`, fed by row 11.
3. The relay serves the mark to the client: `GET /context/game/NHL_2026-09-29_e401891827` carries
   `opening_odds_parsed._kickoff = {"verified":false,"late_minutes":55}` (2026-10-29), so the client change does not depend on a relay deploy.

## Proof

| claim | artifact |
|---|---|
| each relay site honours the mark; non-late output is byte-identical to the code before | `scripts/check-opening-odds-late.mjs`, 67 of 67, on six real D1 blobs (`outbox/fixture-opening-odds-marks-20261029.json`) |
| the check can fail | `scripts/mutate-opening-odds-late.mjs`, 23 of 23 caught (first run 20; three survivors were two swapped-argument sites and a dropped plus sign that the fixtures could not tell apart; fixed by a distinct opening/closing pair and a positive spread) |
| both client layers honour the mark | client `scripts/check-opening-odds-late.mjs`, 5 openings x 2 layers + 2 assembler cases; red on the pre-change source (5 FAIL), green after |
| the client check can fail | client `scripts/mutate-opening-odds-late.mjs`, 9 of 9 caught |
| relay static gates | `gates.py` on the committed tree: 152 of 154 passed; the two failures are the standing env-only ones (BSD frame list HTTP 0; `RELAY_SHARED_SECRET` unset). An earlier run on the first commit found 3 of mine (a prose-site check reading the old inline text, its unwired mutation harness, an anchored citation whose quoted line moved), fixed before the push |
| deploys | Deploy RELAY Worker run 40930832200, success (worker deploy and live-confirm steps green 18:35Z); deploy gate run 40932255038, success (18:37:40Z) |
| the deployed page carries the guard | browser session on the deployed page, 18:41Z: `window.SW_VERSION` = `2026-10-29b`; the served HTML contains `_openingCapturedLate` x3 (definition and both calls), the `late_minutes` read, and the guard line in both layers |

Defect size (D1, 2026-09-16 to 2026-10-29, priced opening lines carrying the late mark): CFB 116 of 183, NHL 97 of 202, NBA 15 of 69,
NFL 4 of 33.

## Something that went red, and why

`CONTRACTS.md identity check` (relay run 40930832186) failed at 18:27Z on the relay push: the relay's `main` carried the new
`opening_odds` bullet and the client's `main` did not yet (log diff: exactly those 7 lines). That workflow compares the two `main`
branches and says to commit CONTRACTS.md to both repos in the same session. Rule 70 puts the relay first, so a CONTRACTS-only change
leaves a red window of one push-to-push gap (18:26 to 18:35Z here). The client push made the copies byte-identical (sha256 `35d63d03…`
on both) and the client-side mirror passed (run 40932254796); the relay-side run was re-run afterwards (attempt 2, success). Not changed:
the check's design. For the next cross-repo CONTRACTS edit, push both repos back to back.

## Verified end to end vs not

- Verified: the helpers, `computeOddsStory`, the real `buildBackfillPrompt`, and both client layers, executed on real blob shapes.
- Read, not executed whole: the debrief block of `buildGameCompletePrompt`, the cron's debrief block, the slate annotation loop and
  `findGame`'s `lineMovement` (cut out of the source and executed as text; the wiring check counts the call sites).
- Not covered: client rows 9 and 10 (`_isUpset`, market consensus), which have no feed. `_consensusOverRate` also reads
  `Number(opening_odds.total)` of an object, which is `NaN`; recorded in `outbox/cfb-saturday-a0-20261029.md`, not fixed.

## Carry-forwards

None owed by this CC-CMD's A2. Remaining in the CFB Saturday CC-CMD: A0.2's job-log half; the 2026-10-31 reading (A1, done condition 4),
armed as `trig_01Xrhu7D91b4WhnQKAcPYQS9` (2026-11-01T04:30Z).
