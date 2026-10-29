# CC session 2026-10-29 (afternoon) — the identity route and the Saturday probe measure something

**Owner's words this window (2026-10-29), through the one question I asked:** A1 "(c) Hold, read 2026-10-31"; B1 "Go with
claude's best recommendations while keeping as much as possible and only retire if necessary"; `/odds/*` cap "Hold, size it
from measured demand". Earlier today: "cfb Saturday approved", "decisions approved". Session doc of the morning:
`outbox/cc-session-2026-10-29-route-a-and-import-check.md`.
**HEAD progression:** `aee34be` (morning close-out) → `5c664f8`, `3f5dabf`, `89f047a` (pushed together, deployed 17:29Z) → this
close-out. Other sessions and bots pushed between them; I rebased twice and never rewrote pushed history.

## Per commit

| commit | what | verified |
|---|---|---|
| `5c664f8` | `feat: /identity/mismatches joins the way the relay's writers do, counts its rows, and is gated` | `check-identity-route-join` 41, mutants 32 of 32; `check-odds-label-split` 80, 27 of 27; Deploy RELAY Worker `40920118796`, Repo guards `40920117821`; self-probe HTTP 401 |
| `3f5dabf` | `fix: the Saturday identity-join probe reads the denominators, sends the secret, and fails when it cannot measure` | `check-odds-join-probe` 88, mutants 47 of 47; `check-saturday-probe-workflow` 35, 19 of 19 |
| `89f047a` | `docs: CFB Saturday decisions recorded …` and the stale watch encodings (B3) | the doc-reading gate steps |
| close-out | this document, the live proof, the CC-CMD statuses, HANDOFF | the doc-reading gate steps (below) |

## What was decided, and the premises that were tested first

B1 was written before the 10-25 shared join: it says to wire `matchSlate` into the route. Rule 100, one command each:
- **Which join decides CFB pricing?** `snapshotCronOdds` uses `indexOddsByPair` and `findOddsForRow` with `start_time`, not
  `matchSlate`. On the real 80-row slate of 2026-09-12: the old route's exact pair key **0**, the cron's join **73**, `matchSlate`
  **80** (7 of them by elimination, 6 when given the 7 alone). So the route uses the cron's join and reports the matcher beside it.
- **Can `matched > 0` ever be the test?** D1 rows for a day are created at about 10:00Z that morning (44 CFB rows of 2026-10-24:
  `created_at` 10:00:51 to 10:01:08) and the cron prices them minutes later. A join that works leaves nothing unpriced, and all seven
  scheduled artifacts (2026-09-13 to 10-25) read `d1_missing` 0 and `matched` 0: "all priced" and "no rows" looked identical. The
  route now sends the denominators and the probe tells them apart. Done condition 4 was restated accordingly.
- **Does the fixture say what the cron would write?** No: its events carry no bookmaker, so `priceable` is 0 on it, and a capture at
  the kickoff instant is late (`kickoffMark`, lateMs 0). Both are asserted, not assumed.

## The review, and what became of each finding

Four independent lenses (contract, gate, probe, checks), 255 tool calls, 44 minutes, read-only, each working in its own copy
of the tree. 32 findings; each was reproduced or quoted from code before it was acted on. One was the blocker I had already
fixed (the doc-citation gate), two I did not change on purpose, and the rest are in the table.

| lens | finding | disposition |
|---|---|---|
| contract | a cited line became a bare citation and the doc-citations gate failed | fixed before the review returned |
| contract | `slate_matched` was computed on the unpriced rows only; the backfill decides the whole slate | **fixed**: whole slate to `matchSlate`, only the unpriced rows counted. Measured: 7 of 7 with the whole slate, 6 with the 7 alone |
| contract | `matched` counted rows the cron would never write (finalized, started, no bookmaker) | **fixed**: `priceable`, the rows the cron would write if it ran now |
| contract | the postseason table was not read, so `NO_ROWS_AT_ALL` could be false in bowl season | **fixed**: both tables, one SELECT each |
| contract | the classifier read `matched` 0 as a failed join even when every game had finished | **fixed**: `NO_JOIN_EVIDENCE` vs `C2_JOIN` from `finalized` and `start_time` |
| contract | the route's mutants could not see sport or date scoping | **fixed**: the world holds other sports, dates and the other table |
| contract | the null denominator was unreachable on D1 (a failing COUNT throws) | **fixed by removing the COUNT**; the denominators come from the same SELECT; the classifier still refuses a relay that does not send them |
| contract | coverage line a tautology; a mis-scoped query reads as empty | coverage **fixed**; `?date=` now required. A lowercase sport label is **not** validated here |
| gate | a secret with a control character is quoted by Node's error and lands in the committed artifact | **fixed**: redacted from every message, with a case and a mutant |
| gate | the published relay secret was never tried through its own header | **fixed**: `X-FIELD-Relay`, a suffix and a prefix are attempted against both gates |
| gate | the dispatch workflow ends red on a date without CFB rows, and its input text said 4 credits | **fixed**: `NO_SLATE` is not a failure; the text says about 12 |
| gate | the gate lands one commit before the callers | **accepted**: one push; the commit message says so. The callers are the next commit |
| gate | `mcpBearerMatches` strips `Bearer ` anywhere and compares with `===` | **not changed**: parity with the admin routes, which the helper's comment states; a spliced header still needs the secret |
| gate | a garbage `date` costs 3 credits and answers 200 | **fixed**: required and validated before any billed call |
| gate | the unauthenticated-routes CC-CMD still said Route B was held | fixed in the close-out |
| probe | the coverage line printed `4 of 4` whatever happened | **fixed**: counts of sports answered and measured |
| probe | the exit-code policy was held by no check | **fixed**: `continue-on-error`, `if: false`, `|| true`, a lost `if: always()` each fail the check and are mutants |
| probe | `ALL_PRICED` counted any non-NULL blob, including lines captured after kickoff | **fixed for lateness**: `PRICED_LATE`. A blob that carries no price is **not** detected (the writers do not store one; not measured) |
| probe | contradictory denominators gave a confident verdict | **fixed**: `DENOMINATOR_INCONSISTENT` |
| probe | CFB is required year-round, so every off-season Saturday ended red after spending 12 credits | **fixed in the verdict**: no rows and nothing in the feed is `NO_SLATE`. The 12 credits are still spent weekly, as before |
| probe | nothing reads the artifact; the push loop exits 0 on contention | **not changed**: the 2026-11-01 wake reads it; the loop is copied across the repo's probes |
| checks | eight classifier mutants survived, the table asserted codes only | **fixed**: the table asserts the numbers in the text; 47 mutants, 47 caught |
| checks | the script exited 0 on a JSON `null`, `false` or `0` body | **fixed** (reproduced first), with a case per body and a mutant |
| checks | the delayed-run clock, the four-sport request and the six-hour window were untested | **fixed**: clock on the Sunday, four sports, and instants at 09:59Z and 10:00Z that tell six hours from five or seven |
| checks | `COVERED` at any ratio exits 0 | **not changed**: a threshold would be a number I invented; the ratio is printed |
| checks | shape-only assertions (`d1_key` contains `|`, finalized priced rows, gate suffix) | **fixed** |

## Gates

`gates.py` on the committed tree (152 steps): the first run of the commits, 147 of 152. Two were the standing environment-only
failures (the BSD frame list HTTP 0; `RELAY_SHARED_SECRET` unset). Three were mine: the absence-collapse ratchet (deploy and
guards; removing two `|| []` sites left the baseline at 204 against 202, so the ratchet's own mutation could not fail) and the
captured-at check (the route's `extractOddsForGame` call omitted the capture instant). Fixed, the baseline lowered with the
tool the ratchet names, and the 62 steps that touch these files re-run: 62 of 62. An earlier run had also failed the doc-citation
ratchet and the Status vocabulary (a rewritten script moved a line a CC-CMD cited). CI on the pushed head: green.

## Verified live, and not

- **Live:** `/identity/mismatches?date=2026-10-29&sports=CFB` with no credential answers 401 `Unauthorized`; `/budget/odds` read 15 s
  before and after is identical (day 758, month 46632, `identityMismatches` 0, every `by_site` and reconcile row).
  `outbox/identity-mismatches-gate-live-proof-20261029T1730Z.md`.
- **Not observed live:** the authorized path and the new report. No secret here, and an off-schedule run spends about 12 credits
  (forbidden without the owner's word). **Unblocked by** the scheduled run on Saturday 2026-10-31; **verify** per the proof's
  last section; the wake `trig_01Xrhu7D91b4WhnQKAcPYQS9` (2026-11-01T04:30Z) reads it and the A1 coverage SELECT together.

## Errors and what they cost

- My first design (wire `matchSlate`, as B1 said) was stale; found by reading `snapshotCronOdds` before building. Cost: none.
- The first version of the route had five defects an independent review reproduced (whole slate, postseason, priceable, date,
  scoping), and the probe could exit 0 having measured nothing on a JSON `null`. The review took 44 minutes and four agents; the
  fixes took about 70 minutes, most of it strengthening checks whose mutants had survived.
- My first push was rejected: a bot's commit had landed between my fetch and my push. Rebased, pushed again.
- A secret with a control character would have been written into the committed artifact by Node's own error message. Found by
  the review, reproduced, redacted.
- An assumption in the workflow mutants was wrong: "0 hours ago" still gives the Saturday at 02:51Z, because that instant is
  22:51 in New York. The window is now pinned at 09:59Z and 10:00Z, where six hours differs from five or seven.

## Observation, not mine to fix here

`/budget/odds` shows `degraded_open` 5 events, 30 credits, reason `charge: D1_ERROR: D1 DB is overloaded. Requests queued for too
long.`, last at 2026-10-29T16:04:03Z. That is the guard's designed fail-open on a D1 error, counted and named. It was not there at
10:53Z. The 2026-10-30T12:00Z wake reads the closed day; if it persists, that is a finding for the per-consumer ceiling.

## Carry-forwards

None owed by this session. Owner decisions that remain: none new. In an existing CC-CMD, unbuilt: TASK A2 of the CFB Saturday
CC-CMD (six relay readers and three client readers, Rule 70) and the job-log half of A0.2. Armed: 2026-10-30T12:00Z
(`trig_019pHMT7Ym3XGHi3KVKQLDZx`) and 2026-11-01T04:30Z (`trig_01Xrhu7D91b4WhnQKAcPYQS9`).
