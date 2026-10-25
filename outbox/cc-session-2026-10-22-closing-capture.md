# CC session — the closing-line capture's 18x over-spend (2026-10-21/22)

`docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`, dispatched by
the owner ("dispatch closing capture"). **Status:** TASK 0 and TASK 1 DONE.
Done condition 3 is STAGED until two closed game days after the deploy.

**HEAD:** `a13cb060` → `ea4e2393`..`9504cf1b` (probe) → `9fcb1ac1`
(diagnostic) → `993fa30` (TASK 0) → `3c390d2` (filed) → `6ef722d` (the fix) →
`82a4c77` (TASK 1 results) → `4d99887` (probe exit) → the restarts CC-CMD →
this close-out. Branch main throughout.

## What landed

| commit | what |
|---|---|
| `ea4e2393`, `3adb1594`, `ce188126`, `9504cf1b` | `scripts/probe-ambient-capture.mjs` and `ambient-capture-probe.yml`. Read-only, with no billed vendor endpoint. `3adb1594` fixed the tail parser: wrangler prints pretty JSON, not JSONL. `ce188126` removed an absence-collapse that had turned guards red |
| `9fcb1ac1` | `/ambient/state?diag=1`: stored versus in-memory scores, the last refused write, the last alarm error, and the instance start time. Read-only |
| `993fa30` | TASK 0 results in the CC-CMD. Filed `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md` |
| `3c390d2` | Filed `docs/CC-CMD-2026-10-22-capture-record-keyed-by-source-id.md` |
| `6ef722d` | The fix (`src/ambient-do.js`), `scripts/check-ambient-capture-dedup.mjs`, its `deploy.yml` step, and the empty-catch pin moved from 319 to 332 |
| `82a4c77` | TASK 1 results. Filed `docs/CC-CMD-2026-10-22-closing-capture-buys-per-game.md`. Extended the coverage-gaps CC-CMD |
| `4d99887` | The probe exits when its window ends: SIGTERM reached `npx`, not the wrangler tail, so two runs hung until cancelled. Each new-instance line now prints the client count |
| next | Filed `docs/CC-CMD-2026-10-22-ambient-do-restarts-on-every-event.md` |
| this close-out | The TASK 0 correction, the deploy verification, the status, this doc, HANDOFF |

## TASK 0: what the probe showed

Source: `outbox/ambient-capture-probe-20261022T002944Z.log`, run 39700004408.
- Every reading carried a refused `scores:today` write: "Values cannot be
  larger than 131072 bytes. A value of size 131814 was provided."
- 19 readings met 19 distinct instances.
- Every instance that had polled restored the same 661 entries, with the
  capture dedup empty.

So every game that went live after the snapshot froze was bought again on
every poll.

**10-20's zero captures** have two causes, both filed:
- `SPORT_ACTIVE_MONTHS` leaves NBA and NHL out of October;
- the poll reads the UTC-dated board, while the relay keys boards by ET date.

**Recorded as unexplained:** some closed days cost less than the model
predicts, for example 10-17 with 50 games and 84 calls.

## TASK 1: what was built, and why it changed shape

The first design pruned an entry when its game was missing from one poll's
boards. Round 1 of the review (19 agents) refuted it with two regressions:
- the relay answers an NHLE or NBA CDN failure with a 200 and an empty board,
  so live games would be dropped;
- a game that left its date's board at 00:00Z would be pruned while still
  being played, letting `all_final` fire.

The commit prunes by age instead. Each game's last board time is stored in
`seen:today`, and its entry is dropped 6h later. The capture record is stored
in `starts:today`, kept 24h, and written before the first vendor call. The
restore is marked done only once its read has succeeded.

Round 2 (18 agents) found no regression against HEAD. Its size lens read real
boards: the stored scores peak at 18–28% of the limit on realistic heavy days,
and 57% with every league at its cap. It found five harness gaps, all closed
before the commit.

**The test.** 29 checks; 14 fail at HEAD, including S2, the restart that
loses the scores entry. 24 mutations, all caught, each named by the check that
catches it.

**Gates, run on clean exports of HEAD and of the change:**
- 125 of 125 runnable gates pass, and the new step passes.
- 3 fail identically at HEAD for lack of secrets or network.
- The absence-collapse ratchet, run in a directory named `field-relay-nba`,
  reports OK.

## Deploy and verification

- **Deploy run 39713304241 was green**, including the new harness step. The
  code step finished at 02:57:28Z.
- **Run 39714396288** (`outbox/ambient-capture-probe-20261022T025948Z.log`)
  spans the switch:
  - until 03:02:23Z, the old code: stored 661 entries, the 131814-byte write
    refused, `gameStartsSize null`;
  - from 03:02:53Z, the new code: `gameStartsSize 0`, stored scores
    **4 entries, 903 bytes**, `lastPutError` null.
- **Run 39716768024** (`…032548Z.log`): for 6 minutes the stored scores held
  at 4 entries and 903 bytes while `lastPoll` advanced every 61 s. No capture
  was charged, and no covered game went live in the window.
- **The live kickoff check is not done yet.** The first covered kickoffs
  after the deploy are on 10-23 (18:30Z, 18:45Z, 19:00Z). A probe across them
  is scheduled for 18:12Z and must show exactly 5 capture calls.

**A correction this verification forced (Rule 100).** TASK 0 said the
refused write caused the restarts. Run 39714396288 shows one instance living
two hours while refusing that write on every poll, so that cause is withdrawn.
- **What is measured:** on the new code every reading meets a fresh instance,
  and all of them read `clients 0`.
- **What is open:** the cause, filed as
  `docs/CC-CMD-2026-10-22-ambient-do-restarts-on-every-event.md`.
- **Why the fix holds anyway:** it stores the scores, the seen times and the
  capture record, so a restart costs nothing at the vendor.
- **The CC-CMD keeps the original sentence struck through**, with the
  correction above it.

## Filed, not fixed (Rule 87.4)

| CC-CMD | what |
|---|---|
| `CC-CMD-2026-10-22-ambient-capture-coverage-gaps` | NBA/NHL are not polled in October. Kickoffs from 00:00Z to the end of the ET day are invisible. Games that left their board are served live, frozen, for up to 6h. The first and the third need decisions: spend, and a payload change |
| `CC-CMD-2026-10-22-capture-record-keyed-by-source-id` | An MLB/WNBA failover gives a live game a new id, so it is bought twice at most |
| `CC-CMD-2026-10-22-closing-capture-buys-per-game` | One charged call per game, though one call covers the sport. This alone can hold done condition 3 above 2x |
| `CC-CMD-2026-10-22-ambient-do-restarts-on-every-event` | AmbientDO instances live under 30 s while no client is connected. The cause is unknown. In-memory state outside the capture (BSD socket, cooldowns, peaks) is lost each time |

## Open

- **Done condition 3: PASS twice.** Run 1 (closed day 10-23) 0.8x, run
  40088714137; run 2 (closed day 10-24) 0.9x, run 40187677225, log
  `outbox/odds-consumer-demand-20261025T110935Z.log`. The CC-CMD is **DONE**.
  - Run 2 found one billed call on 10-24 that no `change_log` row accounts for,
    3 credits of 78. A billed call that writes no line leaves no record, so it
    cannot be named. Filed as
    `docs/CC-CMD-2026-10-25-capture-call-without-a-line-leaves-no-trace.md`.
  - The demand figure for 10-24 carries three NBA groups from the 10-23 ET slate
    (00:00Z, 01:30Z, 02:00Z) that no board listed, before the NBA deploy. They
    are 9 of the 87 credits. The run-2 prompt had said every 10-24 NBA kickoff
    followed the deploy; that holds only for the 10-24 ET slate.
- **The kickoff-window probe** on 10-23 at 18:12Z (`trig_011xqk7…`) expects
  exactly 5 capture calls across 5 covered kickoffs.
  - The read reports charged/demand and 3 × games / demand side by side,
    because of the per-game purchase above.
- **The 150-minute run 39695639761 hung** (the defect `4d99887` fixes) and was
  cancelled at 03:22Z. Its log, `…20261021T234722Z.log`, committed by the
  cancel. It shows the re-buy live: 3–4 capture calls a minute from 23:53Z to
  23:59Z, stopping at the UTC date turn.
