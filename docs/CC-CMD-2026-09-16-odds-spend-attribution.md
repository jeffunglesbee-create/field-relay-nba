# CC-CMD 2026-09-16 — attribute odds spend before changing any ceiling

Status: **BLOCKED.** Tasks 1 and 2 DONE (2026-10-21). Task 3 HELD by the owner
2026-10-23 ("Hold it; fix 3 first") after its premise test (Results, Task 3),
until `docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md` is DONE. Results are under "Results" at the end.
Session doc: `outbox/cc-session-2026-10-21-per-consumer-demand.md`.
Supersedes the demand-derived-ceiling proposal made earlier the same day, which
this document's own probe block refutes.

## Probe block — what was measured, and what it killed

| figure | value | source |
|---|---|---|
| provider billed | **3,557/day** | `outbox/odds-provider-usage-series.json`, 09-05 → 09-16, 41,002 over 11.5 days |
| backfill recorded | **40/day** | `odds_backfill_progress.credits_used`, 580 over 14.6 days |
| backfill share | **1.1%** | the two above |
| everything else | **3,517/day, 98.9%** | subtraction |
| backfill demand | **34/day** | `scripts/measure-odds-demand.mjs`, run 2026-09-16 18:21Z |
| worker demand | **NEVER MEASURED** | — |

**THIS REFUTES THE PROPOSAL IT WAS WRITTEN TO SUPPORT.** Earlier today I
measured backfill demand at 34/day against a 3,800 daily ceiling and called the
allowance 112x the work. That comparison is invalid: the ceiling is shared, and
98.9% of what flows through it is worker-side live polling whose demand nobody
has ever measured. A ceiling set from backfill demand would have cut live odds
coverage dead on its first day.

It also sizes today's work honestly. The matcher, the sport-key registry, the
cup keys and the pairing watcher all govern **1.1% of the bill**.

## Why attribution comes first

Spend is anonymous. `reconcileOddsCredit` (`src/budget-helpers.js:229`) already
receives a `site` argument at all five call sites — `getWCPregameLambdas`,
`handleWCOddsProbs`, `handleCFLOddsProbs`, `fetchSportOddsLive`,
`fetchSportOddsHistorical` — and puts it in the returned object and nowhere
else. No KV key carries a site dimension. Confirmed by grep: the only spend keys
in the tree are `odds:daily:YYYY-MM-DD` and `odds:credits:YYYY-MM`.

So "which consumer spends the 3,517" cannot be answered from stored data. The
1.1%/98.9% split above is only obtainable because the BACKFILL happens to
record its own credits in D1. AmbientDO's live polling, its closing capture, and
the WP resolver are indistinguishable from each other.

**No per-consumer ceiling can exist without per-consumer measurement.** That is
the whole reason this document exists instead of a ceiling change.

## Task 1 — give the ledger a site dimension

Two mechanisms. **The choice is the owner's, because they differ in running
cost, not in correctness.**

**A. Analytics Engine.** `JQ_ANALYTICS` is bound (`wrangler.toml`). AE is built
for high-cardinality, write-heavy telemetry and is cheap per write. Fits
naturally. Risk: the binding is named for journalism quality, and mixing odds
spend into it is a scope change to an existing dataset.

**B. KV, one key per site per day** — `odds:site:<site>:YYYY-MM-DD`. No new
binding, same store as the counters it explains. Risk: **it adds a KV write per
odds call where there is currently none.** `reconcileOddsCredit` returns early
when `delta === 0` and writes nothing; the majority of calls take that path. At
~3,500 credits/day this is a real, recurring write cost — measure it before
choosing.

Done condition: `/budget/odds` returns a `by_site` object whose values sum to
within 5% of `daily.used` for a day with live games in it.

## Task 2 — measure worker demand

Not "what did it spend" — what does it NEED. For live polling that is
approximately: live games in the window x polls per game x `oddsCreditCost` of
the poll URL. `_getOddsCooldown` (`src/ambient-do.js`) sets the cadence per
sport and priority tier; the game count is in the archive.

Done condition: a committed artifact giving worker demand per day for the last
7 days, next to worker spend from Task 1, with the ratio stated.

## Task 3 — only then, a ceiling

Blocked on Tasks 1 and 2. Do not start it earlier.

`docs/IMPACT-2026-09-16-odds-ceilings.md` holds the blast radius: three monthly
implementations that must move together, `reconcileOddsCredit` becoming partly
dead, `/budget/odds` being a consumed contract, `ODDS_CEILING_GRANTS` needing to
keep expiring by inaction, and nine call sites whose refusal shapes must not
change.

## What NOT to do

- **Do not lower `ODDS_DAILY_CEILING` before Task 2.** 98.9% of what it governs
  has unmeasured demand. This is the error this document exists to prevent.
- Do not add a fourth guard implementation. There are already three.
- Do not change the refusal shapes at the nine call sites; five callers
  distinguish `guarded: true` from failure.

## Open and unowned

- The ~19,700 ledger-vs-provider gap. Old (≈17,800 on 09-05), roughly static,
  unexplained.
- Whether `x-requests-used` is monthly-cumulative. `64,546 + 35,454 = 100,000`
  is suggestive; two readings inside one month cannot show a reset.
- Three call sites return `null`/`undefined` on refusal rather than a
  structured `guarded` result.

## Results

### Task 1 — DONE (recorded 2026-10-21)

- **The work:**
  - `71433fee` (2026-09-16) gave the ledger its site dimension.
  - `5edb19ad` (2026-09-19) moved it to D1, charging the day and the site in
    one transaction.
- **First pass:** `outbox/odds-attribution-gap-20260921T155444Z.log` (commit
  `4f0c86c5`), day 2026-09-20. `used 3800`, `by_site_sum 3800`,
  `unaccounted 0`, on a day with live games (MLB 15, NFL 14, MLS 11, and
  others).
- Every attribution-gap log since has passed. Since `5edb19ad` this done
  condition cannot fail, because day and site are written in one batch.

### Task 2 — DONE 2026-10-21

**Artifact:** `outbox/odds-consumer-demand-20261021T224035Z.log`, run
39688177856, from `scripts/measure-odds-consumer-demand.mjs` via
`.github/workflows/odds-consumer-demand.yml`. It covers worker demand per day
for 2026-10-14..10-20, beside charged and kept spend, with the ratio stated:

| consumer | demand | charged | kept | charged/demand |
|---|---|---|---|---|
| ambientCaptureClosingOdds | 300 | 5361 | 5361 | 17.9x |
| handleCFLOddsProbs | 12 | 4746 | 576 | 395.5x |
| fetchSportOddsLive | 141 | 2514 | 2517 | 17.8x |
| fetchSportOddsHistorical | 870 | 1620 | 1620 | 1.9x |
| getWCPregameLambdas | 0 | 108 | 8 | spend, no need |
| handleWCOddsProbs, oddsProxyRoute | 0 | 0 | 0 | both 0 |
| wpResolver | UNKNOWN | 0 | 0 | — |
| **modelled total** | **1323** | **14349** | **10082** | **10.8x** |

Two figures are printed outside that total:
- **fetchSportOddsHistorical, "unwritable":** 570 credits. The join cannot
  write those units' closing lines.
- **ambientFetchLiveOdds, if it were served:** 20,760 credits over 7 days,
  2,966 a day. The path is off (`ODDS_LIVE_PATH_404`).

**What this means for Task 3:**
- **The spec's premise has changed.** "98.9% is worker-side live polling"
  was true on 09-16. Today live polling is switched off.
- **Where the spend goes now:**
  - CFL's charged-but-never-billed estimates (4,746 charged, 576 kept);
  - a closing capture that bills about 18 times its need (5,361 kept);
  - an opening-line cron at 17.8x.
- **A ceiling set from today's spend** would encode those defects rather than
  need.
- **Turning live polling back on** needs about 3,000 credits a day on its own,
  against a 3,800 ceiling.

**Filed from this work (Rule 87.4):**
- `docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`
- `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`

**Why each model has the shape it has:**
- The models were mapped and attacked before any code was written (Rule 100).
- A four-lens review then confirmed 15 findings, all fixed before the push.
- All of it is recorded in the session doc.

### Task 3 — premises tested 2026-10-23, before any build (Rule 100)

Dispatched by the owner ("next approved", 2026-10-23). Four readers and a
premise critic (workflow `wf_c984c219-a1f`), read-only, no credits. Each
premise with the one command that tests it:

| premise | result | evidence |
|---|---|---|
| The shared 3,800 daily ceiling still binds, so consumers crowd each other out | **refuted** | Reached on 10-07, 10-10, 10-11, 10-12 and on no day since. Highest since: 3442 (10-18). 10-19..10-23: 1569, 818, 878, 1521, 492 (partial) |
| The consumers that filled those days still spend that way | **refuted** | Each ceiling day had one leader: WC lambdas 2536 (10-07), live polling 2078 (10-10), closing capture 1608 and 2583 (10-11, 10-12). Live polling is off, WC lambdas net 0 on 10-22/23, the closing capture charged 9 and 21 |
| A site's charged amount is what the vendor billed | **refuted** | 10-14..10-23 charged/kept: CFL 5112/798 (6.4x), WC lambdas 116/8. Closing 5472/5472, live 3510/3513, historical 3030/3030 |
| Kept follows the vendor's bill | holds | Over 10-21T04:36Z..10-23T04:40Z: vendor 2184 for the worker, kept 2247 (2.9% over), ledger 2336 (7.0%) |
| `odds_budget_site` is exact enough to enforce on | holds | Attribution gap 0 on all 23 days |
| One guard implementation | holds | All three wrappers call `chargeOdds`. The IMPACT doc's "three monthly implementations" is history |
| A per-site check fits the existing batch by copying the day predicate | **refuted** | Against a reference model: 398 of 400 sequences disagree. A token-stamped variant (one new column, same five statements) agreed 400 of 400 on SQLite, not D1 |
| A site label is one consumer | **refuted** | `fetchSportOddsLive` and `fetchSportOddsHistorical` each serve a cron and an unauthenticated GET route |
| A refused closing capture loses nothing a later writer fills | **refuted** | The game is recorded bought before the charge, so a refusal is never retried; the only at-kickoff writer is this one (17/17 at T-10 min) |
| The Task 2 demand models still describe need | **refuted** | The live-odds model counts sport-days the path cannot write; closing spend now sits below its model |
| A caller or a watch can tell a ceiling refusal from a failure | **refuted** | No reader of `guarded` in `src/` or the client; no watch exits on `ceiling_reached_at` |
| `chargeOdds` can change now without confounding a pending read | **refuted** | Reads at 10-24 and 10-25 11:07Z, 10-25T06:30Z, and the 11-08..11-23 CFL VOID window |
| The 85,000 monthly limit will not bind in October | holds | 41,036 used; worst case 74,744 |

**The critic's recommendation:** hold Task 3. The ceiling is not binding,
the consumers that crowded it are fixed or off, a cap on charged spend would
bind on credits never billed, and a change to `chargeOdds` now confounds four
scheduled reads. Build first: (1) a refused closing capture becomes
retryable; (2) the opening-line cron stops re-buying NBA, NHL, CFB and NFL,
which it never writes (the largest site on 10-23, 267 of 492; how much of it
those four sports are is UNVERIFIED, the tally has no sport column); (3) a
refusal becomes visible to a watch. When Task 3 does land: the token-stamped
batch, a site-veto signal of its own, `mutate-odds-budget-batch.mjs` and
`check-odds-ceiling-grant.mjs` updated in the same commit, caps only where
charged equals kept, values from post-fix demand.

**Also when Task 3 lands: a month veto charges neither the day nor the
site.** Moved here 2026-10-23 from item 1 of
`docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` (BUILD-ON-A; audit
`wf_dd67792d-4ca`), because it rewrites the same five-statement batch and is
a capacity change under the 2026-10-18 ruling ("Do not fix the over-record
yet"). What was seen: a harness against HEAD `src/budget-helpers.js`, KV
month seed 84998: `chargeOdds(env, 3, 'ambientCaptureClosingOdds')` returned
`false` and left `odds_budget.used = 3` and `odds_budget_site.used = 3`, the
month at 84998. The source calls it intentional ("The day and the site keep
their charge and the call is refused"). Since fix 1 of the prerequisites
(`da44521`), a declined capture is retried each poll inside its 10-minute
window, so under a month veto each sport window adds up to 3 per poll (40
polls at 15 s, 10 at 60 s) to the day and site with no vendor call; 29
windows on a busy Saturday could reach the day ceiling on phantom charges.
It binds only near the 85,000 month limit (41,036 on 10-23, worst case
74,744 for October), and fix 3 (`35d61ec`) turns the pairing watch red as
soon as month headroom is below the largest call, so it cannot happen
unseen. **Same commit:** `check-monthly-atomic.mjs` case B ("today's
behaviour, pinned") and the "day keeps its charge" case of
`mutate-odds-budget-batch.mjs` change with it.

**Corrections to this document** (Rule 72): "five callers distinguish
`guarded: true` from failure" is false at HEAD (none does); "three monthly
implementations" is history. Both stand above as written on 09-16.
Appended 2026-10-23, the "Open and unowned" list, each item to its owner
(found by the audit `wf_dd67792d-4ca`; the list stands as written):
- The ~19,700 ledger-vs-provider gap: `docs/CC-CMD-2026-09-19-daily-vs-vendor.md`,
  ruled 2026-10-18; the sign has since reversed (ledger over vendor). The
  window-aligned residual is `docs/CC-CMD-2026-10-13-vendor-residual-window.md`
  (OPEN). Not a work item here (09-19: "Do not fix the over-record yet").
- Whether `x-requests-used` is monthly-cumulative: answered in 09-19 Task 0c
  (it reset; the pairing watch saw the counter go backwards on 2026-09-17).
- Call sites that return `null`/`undefined` on refusal: `_captureClosingOdds`
  now returns `false` and retries (prerequisites fix 1, `da44521`); a refusal
  of any caller turns the pairing watch red (fix 3, `35d61ec`).
  `getWCPregameLambdas` (`return null`) and `_fetchLiveOdds` (bare `return`,
  live polling off) are unchanged.

**Owner ruling 2026-10-23: "Hold it; fix 3 first".** The three fixes are
`docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md`. The other defects
found are filed: `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md`,
`docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md`,
`docs/CC-CMD-2026-10-23-odds-spend-without-need.md`,
`docs/CC-CMD-2026-10-23-odds-docs-stale.md`. A content audit of those four
against every existing CC-CMD (workflow `wf_dd67792d-4ca`, BUILD-ON-A)
narrowed each: accounting-edges item 1 is above; prerequisites fix 2, the
historical triggers and the demand-model splits are in
`docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`; the
stale "Open and unowned" list is answered in the Corrections above.

