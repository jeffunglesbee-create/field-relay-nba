# CC session — 2026-10-11f — the overcharge was a 404 loop

**HEAD:** `1c929a4` → this commit.
**Documents:** `docs/CC-CMD-2026-10-11-no-header-estimates-unreconciled.md` (DONE),
`docs/CC-CMD-2026-10-11-odds-live-path-404.md` (OPEN, filed per Rule 87.4).

## The finding

`_fetchLiveOdds` called `/v4/sports/{sport}/odds-live`. **The vendor does not
serve that path.** Run `38186065943`, from a runner, literal invalid key:

```
/v4/sports/soccer_fifa_world_cup/odds       401 INVALID_KEY
/v4/sports/soccer_fifa_world_cup/odds-live  404 Not Found
/v4/sports/soccer_epl/odds                  401 INVALID_KEY
/v4/sports/soccer_epl/odds-live             404 Not Found
```

Every call was a 404. `if (!r.ok) return;` sits below the fetch, so **the
function has never produced a single odds row**, while the line above the fetch
charged our ledger 2 credits per attempt — `oddsCreditCost` on that URL returns
2, which is where the exact 2.0 per call came from (2074/1037, 796/398,
674/337, 578/289, all four exact).

A 404 carries no `x-requests-last`, which is why reconcile recorded `no-header`
on every one, and a 404 is billed nothing, which is why the vendor's figure
never moved with ours. **That is the residual:** watch 1 measured −1967 for
2026-10-10 against 2074 unreconciled credits the same day, two instruments
sharing no code path, agreeing to within 107.

## Two premises in the document itself, both refuted before being followed

1. **"Probe from a runner with the same `cf` options."** `cf` is a Workers-only
   argument to `fetch`. A runner cannot set it and `cf-cache-status` never
   appears on a request that does not pass through the relay. Followed
   literally, that instruction would have produced a confident reading of a
   cache state that was never the mechanism.
2. **"This costs 1-2 credits."** It cost **zero**. The question was whether a
   PATH resolves, and an invalid key answers that: 401 means yes, 404 means no,
   neither is billable.

## The decision — a third answer

Neither Task 1 (refund EXPIRED) nor Task 2 (stop using cacheEverything). The
charge is not right and the receipt is not lost: there was never a call to bill.

**Stop making the call; do not repoint it without a budget.** `/odds` would
succeed and bill for real, eleven sports on a 15-second poll, against a ceiling
already reached at 14:03:59Z. `src/odds-sport-keys.js` says raising ambient's
coverage is a budget change made under its own document, and that is
`docs/CC-CMD-2026-10-11-odds-live-path-404.md`.

## What guards it

`scripts/check-odds-live-disabled.mjs`, 7/7 with six mutations:

| mutation | what it would cost |
|---|---|
| M1 constant flipped to false | the 404 loop resumes |
| M2 constant deleted | same, with a crash risk |
| M3 guard deleted | same |
| **M4 guard moved BELOW the charge** | still disabled, still spending |
| M5 URL repointed, guard kept | the repointed call is never made |
| M6 URL repointed, guard removed | clean — the check must not block the fix |

M4's first version reinserted the guard in FRONT of the charge and reported NOT
CAUGHT against a working check. The anchor is the whole charge statement now.

## Rule 91 — the residual stops carrying a known quantity

`noHeaderCredits` reports the tally beside the residual, not inside it:

```
  unreconciled estimate  : 2074 over 1037 call(s) in state no-header
                           from ambientFetchLiveOdds
  residual after it      : 107   (the part no named cause accounts for)
```

Null rather than zero when the tally cannot be read. 20 self-tests, 14/14
mutations including two new ones.

## Three things I broke and fixed in the same session

1. **The bare-catch control's pinned line.** `--require=src/ambient-do.js:306`
   is a positive control; my 5-line insertion moved that site to 311. Verified
   as the same `try { writer.close(); } catch (_) {}` rather than assumed from
   the offset. The count never moved — bare held at the baseline of 112.
2. **I fixed one copy of two.** The pin lives in `guards.yml` AND `deploy.yml`.
   Re-pinning only the first turned guards green while the deploy stayed red,
   and because that commit touched no `src/` path it triggered no deploy at all
   — so the fix was not live while every signal looked fixed. Two literals that
   have to agree, which is the shape this repo keeps paying for.
3. **I perturbed the measurement by looking at it.** Dispatching
   odds-daily-vs-vendor at 00:10Z to see the new tally inserted a reading 5.5h
   early. Its own window became 18.5h and was refused, the next scheduled run
   would have differenced a 5.5h window and been refused too, and
   odds-daily-vs-monthly — reading the same series — reported `EXCESS 645
   (1.03x)` and failed, because its arithmetic assumes a ~24h cadence. Removing
   the row restored `17943 <= 18021, no contradiction`. **A watch that
   differences two readings cannot be dispatched for a look without changing
   what it measures.**

## Verified E2E vs STAGED

| thing | state |
|---|---|
| `/odds-live` is a 404, with the `/odds` control | **VERIFIED** — run 38186065943, 0 credits |
| the charge is 2 per call | **VERIFIED** — `oddsCreditCost` run locally on the real URL |
| the guard returns before the charge | **VERIFIED** — 7/7, M4 is the position check |
| watch 1's tally line | **VERIFIED** by self-test and mutation; **STAGED** against live data — the ~05:40Z scheduled run prints it |
| deploy | **VERIFIED** — run 38186673939, deploy and verify both success |
| guards | **VERIFIED** — run 38186574542 success |
| `no-header` credits reaching zero | **STAGED** — the first fully clean closed day is 2026-10-13; it is done condition 3 of the odds-live-path-404 document |

## Manifest

| | |
|---|---|
| endpoint probe + workflow | `0fcd32d`, run `38186065943` |
| the 404 fix + its gate | `9e933d4` |
| the residual names the tally | `36c10e6` |
| bare-catch re-pin + scope exclusions + both documents | `d941c1a` |
| deploy.yml's copy of the pin | `923eff6` |
| the series row my dispatch inserted, removed | this commit |
| deploy run | `38186673939` success (dispatched — the fix commit's own deploy had failed on the stale pin) |
| guards run | `38186574542` success |
| credits spent | **0** |

**Residuals, both genuine:** the live tally line needs the scheduled run, and
`no-header` reaching zero needs a closed day that is entirely post-deploy.
Neither is deferred work — both are a clock.

**Noted, not acted on:** `d941c1a` bundled the two documents with a CI fix
because of a `git add -A`. One concern per commit, and that one carried two.
