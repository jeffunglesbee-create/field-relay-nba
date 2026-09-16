# Impact analysis — the odds spending guards

Read-only. No code changed. Written before any ceiling change, per Rule 39
(map every dependency, audit every consumer, write the diagnostic first).

Date: 2026-09-16. All line numbers read from HEAD at the time of writing.

## What is actually there

Two counters, not three. I said "three ceilings that never reconcile" several
times today and the second half of that is **wrong for the worker**.

| counter | KV key | ceiling | implementations |
|---|---|---|---|
| daily | `odds:daily:YYYY-MM-DD` | 3,800 | **1** — `checkAndIncrementDailyOdds`, `src/budget-helpers.js:60` |
| monthly | `odds:credits:YYYY-MM` | 85,000 | **3** — see below |
| CI per-run | *(none — a local variable)* | 2,700 | 1, `.github/scripts/odds-backfill.js:38` |

The monthly ceiling is implemented three times over **one shared KV key with
one shared limit**:

- `src/index.js:6525` `consumeOddsCredit`, `ODDS_HARD_LIMIT = 85000` (`:6499`)
- `src/wp-resolver.js:217` `consumeOddsCredit`, `ODDS_HARD_LIMIT = 85000` (`:46`)
- `src/ambient-do.js:1126` `_consumeAmbientOddsCredit`,
  `_AMBIENT_ODDS_HARD_LIMIT = 85000` (`:1120`)

I initially read the differing names — `_ambientOddsCreditMonthKey`,
`_AMBIENT_ODDS_HARD_LIMIT` — as a separate budget that would ADD to the others.
It is not. All three build the same string, `odds:credits:${year}-${month}`, and
compare against the same number. **The worker's two ceilings do reconcile with
each other.** Triplicated code, single counter.

That materially shrinks any fix: the unreconciled party is CI alone.

## Every consumer, and what it does when refused

All three worker guards call `checkAndIncrementDailyOdds` first, so the daily
layer can veto every one of them.

| call site | guard | on refusal |
|---|---|---|
| `src/index.js:1166` `getWCPregameLambdas` | `consumeOddsCredit` | `return null` |
| `src/index.js:3267` `handleWCOddsProbs` | `consumeOddsCredit` | HTTP 503, `guarded: true` |
| `src/index.js:3412` `handleCFLOddsProbs` | `consumeOddsCredit` | HTTP 503, `guarded: true` |
| `src/index.js:6571` `fetchSportOddsLive` | `consumeOddsCredit` | `{games: [], quotaRemaining: null, ok: false, guarded: true}` |
| `src/index.js:6678` `fetchSportOddsHistorical` | `consumeOddsCredit` | same shape as above |
| `src/ambient-do.js:613` `_fetchLiveOdds` | `_consumeAmbientOddsCredit` | bare `return` |
| `src/ambient-do.js:793` `_captureClosingOdds` | `_consumeAmbientOddsCredit` | `console.warn` + `return` |
| `src/wp-resolver.js:260` | `consumeOddsCredit` (local) | `{games: [], quotaRemaining: null, ok: false, guarded: true}` |
| `.github/scripts/odds-backfill.js:264,301` | `remainingBudgetRef.value` | `break` / skip date |

Five of nine return a structured refusal a caller can distinguish from an
error. Three return nothing at all — `src/index.js:1166` returns `null` and
both AmbientDO sites return `undefined` — so a caller cannot tell "we declined
to spend" from "the provider failed". `handleWCOddsProbs` documents the
distinction it makes (503 + `guarded` vs the catch's 500) precisely because the
others do not.

## What a change to the guard's STATE would touch

If the monthly counter is replaced by a read of the provider's
`x-requests-used` (the design sketched earlier today), the blast radius is:

1. **Three implementations must change together**, or one keeps summing while
   two read. They are not imports of each other — a change to `src/index.js`
   alone leaves `wp-resolver.js` and `ambient-do.js` on the old scheme.
2. **`reconcileOddsCredit` (`src/budget-helpers.js:229`) becomes partly dead.**
   It exists to correct a locally-summed total using `x-requests-last`. If the
   total comes from the provider, the correction has nothing to correct. Its
   cache-hit and `no-header` branches still carry information worth keeping.
3. **`peekDailyOdds` / `peekMonthlyOdds` feed `/budget/odds`**, which
   `scripts/watch-odds-pairing-rate.mjs` and `scripts/odds-quota-probe.mjs` both
   read. The response shape is a consumed contract, not an internal detail.
4. **`ODDS_CEILING_GRANTS`** (`src/budget-helpers.js:35`) is a dated one-day
   grant mechanism. Any new ceiling has to keep the property that a grant
   expires by doing nothing.
5. **Nine call sites** above must keep returning the same refusal shapes, or the
   callers that distinguish `guarded` from failure stop being able to.

## What is NOT established here

- Whether `x-requests-used` is monthly-cumulative. The arithmetic is suggestive
  — 64,546 used + 35,454 remaining = exactly 100,000, the plan size — but two
  readings inside one month cannot show a reset. **Unverified.**
- Whether a demand-derived ceiling is computable. That is the separate
  measurement, below.
- The ~19,700 ledger-vs-provider gap. Unexplained, old, roughly static.
- Concurrency. All counters are non-atomic read-modify-write and say so. This
  analysis does not quantify the race.
