# CC-CMD 2026-09-16 — attribute odds spend before changing any ceiling

Status: **DONE.** Tasks 1 and 2 DONE (2026-10-21). Task 3 released by the owner
2026-10-28 ("go task 3"), after its hold ("Hold it; fix 3 first", 2026-10-23)
lifted when `docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md` went DONE; built and
deployed the same day (commit `5b92e04`, Deploy RELAY Worker run 40731128552), all five
Task 3 done conditions met (see "Task 3 — DONE" under "Results"). It landed ten days
before the CFL experiment's VOID window (2026-11-08..11-23). A real site refusal has not
been seen live; that is staged, not owed (Rule 74), and is recorded there.
Session doc: `outbox/cc-session-2026-10-28-site-caps.md` (Task 3);
`outbox/cc-session-2026-10-21-per-consumer-demand.md` (Tasks 1 and 2).
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

### Task 3 — build, 2026-10-28

Released by the owner on 2026-10-28 ("go task 3"). Every prerequisite is DONE:
fix 1 (`da44521`), fix 3 A-D, the shared join (`d46106b`, `f4bea6a`).

**What Task 3 is now.** The 10-23 premise test refuted "the shared ceiling binds":
it has not bound since 10-12. So this is insurance, not a correction: a per-site
cap so that one consumer going wrong cannot spend the day's budget, with the
month veto made to charge neither the day nor the site (moved here from
`docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md`).

#### Probe block (D1 `cc49101c`, `odds_budget_site`, 2026-09-20..10-27; Rule 100)

| premise | command | result |
|---|---|---|
| The shared 3,800 ceiling still does not bind | `SELECT day, used FROM odds_budget WHERE used >= 3799` | last reached 2026-10-12. Highest day since: 3,442 (10-18) |
| Every ceiling day since 09-20 had one site that did not need to be that large | per-site `used` by day | 09-21/22 WC lambdas 1,764 and 1,772; 09-23..09-29 closing capture 1,482 to 2,958; 10-07 WC lambdas 2,536; 10-10 live polling 2,078 (`ambientFetchLiveOdds`, now off); 10-11/12 closing 1,608 and 2,583 |
| Those sites have since been fixed | the same table | closing capture since the 10-22 fix: 9, 27, 78, 90, 33, 36 a day. WC lambdas: at most 76 since 10-13 |
| A cap on **charged** spend binds on credits never billed | `charged` against `kept`, 10-14..10-23 (re-read on the closed range 2026-10-28) | **true for CFL (5,112/798, 6.4x) and WC lambdas (116/8)**; false for closing capture 5,478/5,478, live 3,618/3,621, historical 3,060/3,060 |
| A candidate set of caps would have changed history | `outbox`-free arithmetic on the table above | below |
| A per-site predicate fits the existing batch by copying the day's | reference model over 2,000 random sequences on node:sqlite | **refuted**: 973 of 2,000 agree. The gate-table batch below agrees on **2,000 of 2,000** |

**Candidate caps** (about twice the largest closed-day charge of the site since
10-13, rounded: live 1,020 → 2,000 is 1.96x, historical 900 → 1,800 is 2.0x, WC
lambdas 76 → 300 is 3.9x; the closing capture's charge since the fix is only 90 a
day, so its cap is a busy-Saturday demand estimate. The first draft of this
section said "the smallest round number at least twice", which two of the four do
not satisfy: the caps are policy, and the review of 2026-10-28 corrected the
wording, not the numbers):

| site | cap | largest closed day since the fix | why this site |
|---|---|---|---|
| `ambientCaptureClosingOdds` | 400 | 90 charged; demand 87 on 10-24 | 14 days above the cap since 09-23, 16,090 credits over it |
| `fetchSportOddsLive` | 2,000 | 1,020 (10-24, a Saturday) | the opening-line cron |
| `fetchSportOddsHistorical` | 1,800 | 900 (10-22) | `/archive/game` closings and backfill |
| `getWCPregameLambdas` | 300 | 76 | 10-07: 2,536 in a day |
| `handleCFLOddsProbs` | **none** | charged 2,058, kept far less | strands estimates; options 2 and 3 are held |
| `ambientFetchLiveOdds`, other sites | none | path off | needs about 3,000 a day if served; set a cap when it is switched on |

Replayed on the daily rows, these caps would have refused 21,514 credits between
09-20 and 10-27: 16,090 of closing capture over 400 and 5,424 of WC lambdas over 300
(the live and historical caps never bind). 10 of the 11 days that reached the shared
ceiling would have stayed under it; the 11th, 09-20, was led by the uncapped polling
path, and 10-10 would only have fallen to 3,606 for the same reason. The largest
use of any capped site since 10-13 is 1,482 for the closing capture (a
pre-fix day), 1,020 live, 900 historical and 76 WC lambdas; the first is the
over-buying itself, and since the 10-22 fix none is above 90.

#### Design

- **One new table, `odds_budget_gate(id, token)`,** created with the others, one row
  by convention (`INSERT OR REPLACE ... SELECT 1, ?`). No `ALTER TABLE` and no change
  to a table the old code reads, so a deploy that is half rolled out cannot break
  either side. It carries no `CHECK (id = 1)`: the first draft did, and a review
  noted that a CREATE the production D1 rejected would fail the shared
  `ensureOddsBudgetTables` batch, so every `chargeOdds` call would degrade open and
  the guard would be off. Plain SQLite accepts the constraint, but a constraint
  nothing needs is not worth that risk.
- **The batch** (eight statements, `charge` still last):
  `seed`, `monthSeed`, `siteSeed` (the site's row at 0), `snapshot` (a SELECT of the
  three pre-charge totals, for the veto reason), `gate`, `siteCharge`,
  `monthCharge`, `charge`.
- **`gate` is the only statement that decides.** It writes this call's random token
  into the gate row only if the day, the month and the site all have room over their
  pre-charge totals. The three charges each apply only when the gate row holds this
  call's token. A call is therefore charged to all three or to none, which is the
  reference model, and a month or a site veto leaves the day untouched.
- **The reason** is read from `snapshot` in JS: day first, then month, then site (the
  existing precedence: the day is read before the month).
- **A site veto signal of its own:** `odds:daily:<date>:warned:site:<site>`, an ISO
  stamp with the day stamp's TTL, served by `/budget/odds` as
  `site_ceiling_reached_at`, with the caps as `site_ceilings`. The pairing watch's
  refusal verdict reads it.
- **A call no caller can produce** (units NaN, null, a string, negative or infinite;
  a site that is null, empty or not a string) throws to the degrade-open path and is
  counted there as `charge: odds charge: ...`. Without it the gate (SQL binds NaN as
  NULL) and the reason (JS) disagree, and the call was refused by accident (NaN) or
  charged and counted as escaped (`'3'`).
- **`/budget/odds`** also serves `site_stamps_unreadable`: the sites whose stamp read
  failed, so a null in `site_ceiling_reached_at` says which of the four is unknown.
- **Grants** keep expiring by inaction: an `ODDS_CEILING_GRANTS` entry may carry
  `siteExtra: { site: extra }`, which counts only on its date.
- **Also rebuilt:** `POST /debug/odds-budget-latency` (dispatch-only), which the
  change broke and a review found; it now times the eight statements. See the review.
- **Not changed:** the refusal shape at the nine call sites (`false` from `chargeOdds`),
  the reconcile corrections (`fixDay`, `fixSite`, `fixMonth`), the month's 50/75/90%
  warnings.

**Cost.** One more row written per charge (the gate) and one more statement per
batch. Rows written per call go from 3 to 4.

#### Review of the build, 2026-10-28 (workflow `wf_f45e3a89-b2e`)

Five lenses on the diff (SQL and token semantics; callers and regression; operations,
docs and rulings; test integrity; a differential against the previous charger), each in
its own clone and required to reproduce what it reported, then a skeptic per finding
trying to refute it (two for each of the three reported as high). 42 agents, 5.5M
tokens, 107 minutes. 34 reproduced findings, 33 confirmed on re-run, 1 refuted. The
three reported as high were test gaps that the skeptics rated medium or low; none was
a defect that would overspend. Disposition:

| finding | disposition |
|---|---|
| `POST /debug/odds-budget-latency` prepared `ODDS_BUDGET_SQL.site`, removed by this change, and answered 500 (reported by four lenses) | **fixed**: rebuilt on the eight statements, cleaning up its own gate rows. New gate `scripts/check-odds-sql-binds.mjs` (every `ODDS_BUDGET_SQL` reference names a statement that exists and binds as many values as it has placeholders): on the pre-fix source it fails on exactly the six lines the reviewers named; 8 mutants |
| units NaN / null / `'3'` and a null site flipped from a refusal (or a charge) to a spend counted as escaped | **fixed**: validated at the top of `chargeOdds` and counted as a degrade-open with its reason; `check-odds-site-caps` cases I (8 inputs) and 2 mutants |
| the day ceiling and the 09-13 grant were pinned by no check (the model read the ceiling back from the module); no check ran `chargeOdds` on a granted date | **fixed**: literals 3,800 and 6,300 and the grant's two neighbouring days; the granted day run through `chargeOdds` (a charge above 3,800 is charged and not a degrade; a month veto there is filed as the month's); 3 mutants |
| the site-veto stamp's catch was untested (a rethrow lets a refused call spend) | **fixed**: cases K (get, put, unprintable) and 2 mutants |
| the verdict/reason guard was tested in one direction | **fixed**: the reverse direction (gate refused, snapshot says room) is counted, and a mutant weakens the guard to one direction |
| `correctionsUnguarded` was vacuous for the day's fix (a single-quoted constant read as `''`) and had no assertion for the month's | **fixed**: the reader takes either quote form, an unfound statement is a failure, a literal ceiling counts, the month is checked; refunds executed at the caps; 4 mutants. This was a defect in this change's own rewrite |
| no check tied a capped key to the label a call site passes (a consistent rename uncaps a consumer) | **fixed**: `check-odds-site-caps` reads the three files; 4 mutants |
| the check was wall-clock dependent (a run across 00:00 UTC went red, and in `deploy.yml` that blocks a deploy) | **fixed**: the clock is pinned for the run |
| the mutation harness counted a crash as caught; Ctrl-C left mutated files | **fixed** in the harnesses this change touches: caught only on a failed assertion; signal handlers restore |
| the pairing watch asserted only the state of a site refusal, and printed the earliest hour beside every site | **fixed**: `at` and each site's own hour are asserted and printed as pairs; 3 mutants |
| the `true` (hour unknown) state of a site stamp, a failed read that did not say which site, two same-date grants, `siteCeilingFor`'s default table | **fixed**: each has a case and a mutant |
| stale comments in `chargeOdds` (predicates "moved, not changed"), the cap-derivation rule, and the charged/kept figures (re-read on the closed range: 5,478/5,478, 3,618/3,621, 3,060/3,060) | **fixed** in the code and in this document |
| this document lost its H1; two other CC-CMDs still said Task 3 was held | **fixed** |
| a day grant of the 09-13 shape no longer buys a capped site | **documented** where the caps are defined: such a grant must carry `siteExtra` |
| a failed site-stamp write reads as a clean day | **recorded**: the owner-deferred fix 3 E residual (`docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md`) now covers site stamps too; not built |
| a refused `fetchSportOddsHistorical` is filed as "no matches" and the dead-hour backfill marks the date tried for 30 days; the 1,800 cap is a second way to be refused | **folded into** item 4 of `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` (BUILD-ON-A), which already owns it; not built here |
| the capped labels `fetchSportOddsLive` and `fetchSportOddsHistorical` are shared with unauthenticated routes, so an anonymous caller can now exhaust a cap and starve the cron's own consumer | **recorded** in `docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md`, which owns the label split; this change caps the shared labels and does not split them. A reviewer reached the live cap in 134 requests on a fetch with no edge cache; the live rate is UNVERIFIED |
| unverified, left standing: whether production D1 serialises two batches (the premise the daily batch has always rested on). With one gate row, an interleaving would under-charge instead of the old design's small over-spend; it surfaces as a verdict/reason disagreement and is counted | **accepted**, as the CC-CMD's design section already says |

#### What the rewrite kept (BUILD-ON-A: build on what was learned, do not discard it)

The first version of this change deleted the old statements, the old executed
mutants and the old check header outright, on the grounds that the gate replaced
them. The owner pointed out on 2026-10-28 that a replaced mechanism is not a
discarded finding. Where each piece of knowledge lives now:

| what the removed code knew | where it is |
|---|---|
| `ODDS_BUDGET_SQL.site` and `SQL_SITE` / the old `SQL_CHARGE` / the old month statement, and why the order was the argument (Task 2, 2026-09-19; the month, 2026-10-18) | as text, with the 2026-09-19 "verified against real SQLite" result, in the comment block above `SQL_SEED` in `src/budget-helpers.js`. The key is not kept as code: a dead statement is Rule 63, and a consumer of it now fails `check-odds-sql-binds.mjs` |
| the executed behavioural mutants E1-E7 of `mutate-odds-budget-batch.mjs`, and the three gap signs they reproduced (daily 90 / sum 60; 90 / 150; 150 / 90) | **restored** as E1-E9 on the eight statements, in the same file, still read from the source: E2 reproduces 90 / 150, E3 150 / 90, E9 is the 2026-10-18 change reverted (month short). Controls added for the month limit, the site cap and a stop inside the batch |
| "the spec was self-contradictory, and the resolution is the order" (`check-odds-budget-batch.mjs` header) | kept as a HISTORY section of that header, with the month's joining |
| the deploy-path comment on the batch step ("charge-before-site gives daily 90 / sum 60 ...") | kept, with a dated note on what superseded the mechanism and which mutants now reproduce it |
| `check-monthly-atomic` case B and `check-ambient-capture-write` W22, which pinned "a month veto keeps the day and site charge" | changed in this commit as the 10-23 note required; their comments say what the behaviour was and why it changed |
| the `by_site` / `site` accounting of the day batch | unchanged: the corrections (`fixDay`, `fixSite`, `fixMonth`), the verdict from `charge` last, `chargedFromBatch`, the month read by name |

#### Done condition (Rule 90 artifacts)

1. A reference-model check over at least 2,000 random sequences, each with a day
   ceiling, a month limit and per-site caps, agreeing on every verdict and every
   total; and its mutation harness (each mutation of the gate, the order or a
   predicate turns it red).
2. `check-monthly-atomic.mjs` case B and the "day keeps its charge" case of
   `mutate-odds-budget-batch.mjs` changed in the same commit, as the 10-23 note
   required.
3. `/budget/odds` serves `site_ceilings`, and a site veto sets
   `site_ceiling_reached_at` in a harness that reaches a cap.
4. Every `deploy.yml` and `guards.yml` step but the two environment-only ones, on a
   clean worktree.
5. After the deploy: a charge made by the worker itself leaves a gate row and moves
   `odds_budget_site` and `odds_budget` by the same amount, and `degraded_open` stays
   0, read through `/budget/odds` and D1 and committed.

**Stop conditions.** The change touches `chargeOdds`, so it may not land from
2026-11-08 to 11-23. If the review leaves a high-severity finding open on 2026-11-06,
it does not land before 11-24, and this section says so.

### Task 3 — DONE 2026-10-28

| done condition | artifact |
|---|---|
| 1. a reference-model check over at least 2,000 random sequences, and its mutation harness | `scripts/check-odds-site-caps.mjs`: 135 checks; the real `chargeOdds` agrees with the model on 2,000 sequences of 25 calls (50,000 calls; vetoes day 9,830, month 9,589, site 1,768). `scripts/mutate-odds-site-caps.mjs`: 38 of 38 caught |
| 2. `check-monthly-atomic` case B and the "day keeps its charge" case changed in the same commit | `5b92e04`: case B now "a month veto charges neither the day nor the site"; `check-ambient-capture-write` W22 changed with it; `mutate-odds-budget-batch.mjs` B-mutants reworked and its E1-E9 executed half restored on the eight statements (26 of 26 caught) |
| 3. `/budget/odds` serves `site_ceilings`, and a site veto sets `site_ceiling_reached_at` in a harness that reaches a cap | live: `outbox/odds-site-caps-live-proof-20261028T172529Z.md` §1. In the harness: `check-ceiling-reached.mjs` (39 checks, 44 mutants caught) and `check-odds-site-caps.mjs` |
| 4. every deploy and guards step but the two environment-only ones | `gates.py` on a clean worktree named `field-relay-nba`: 141 of 145, the two environment-only failures plus the scope-claims step in both workflows (fixed; the step, its mutation and the two checks re-run); then CI ran the same steps on `5b92e04`: Deploy RELAY Worker 40731128552 and Repo guards 40731128567 green |
| 5. after the deploy, a worker charge leaves a gate row and moves the site and day counters equally, `degraded_open` 0 | `outbox/odds-site-caps-live-proof-20261028T172529Z.md` §2-3: +9 on the day, +9 on the site split, +9 on the month; one `odds_budget_gate` row, a v4 UUID token; `degraded_open` 0 events |

**Stop conditions.** Not triggered: the review (workflow `wf_f45e3a89-b2e`) left no high-severity
finding open (the three it rated high were test gaps, rated medium or low on re-run, and were
fixed), and the push was 16:58Z on 10-28.

**Not observed live: a real refusal.** This is not a staged item. Nothing is waiting for an
unblock: a site cap refusing a call is an event that may never happen, and on a healthy day it does
not. What the live evidence does not show is the stamp, `site_ceiling_reached_at` and the pairing
watch's refusal line on a real refusal; the check executes that path (135 checks, 38 mutants), the
live route has not seen one. No site has come near its cap since the deploy (the closing capture's
charge since 10-22 is at most 90 against 400). It is read mechanically, not by memory: the daily
pairing watch (`scripts/watch-odds-pairing-rate.mjs`, `Odds watches: daily read`) prints
`refusals, closed day <D>` and goes red on a site refusal, naming the site and the hour; a wake on
2026-10-30 12:00Z reads the first closed full day (2026-10-29) beside it. What to read on any day:
`/budget/odds?date=<D>` with `site_ceiling_reached_at` non-null for the capped site, `by_site` at or
below its cap, `degraded_open.events` 0, `by_site_sum == used`.

*Correction, 2026-10-28 18:20Z.* This paragraph was first written as a bold staged-item heading with
no verifier named, which `scripts/staged-verifier-check.mjs` (deploy.yml, every push that touches the
relay) rejects: it turned the check red on `main` from the close-out commit until it was reworded.
It was found by the BSD WebSocket session, not by this one: the close-out was a docs-only commit, so
`deploy.yml` did not run, and `guards.yml` does not carry that step.

**Owner's decisions still open, none of them blocking this CC-CMD:** fix 3 E (a failed stamp write
reads as no refusal; it now also covers site stamps); whether to split the two capped labels shared
with unauthenticated routes (`docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md`); the
cap numbers themselves, which are policy.
