# CC-CMD 2026-09-16 — attribute odds spend before changing any ceiling

Status: SPEC. Nothing here is implemented.
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
