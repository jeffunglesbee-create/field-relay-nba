# Session doc — 2026-09-19b: the atomic odds counter, and Whoop

**HEAD:** `da94524` → `ae606dc`
**Credits spent at the vendor: 0.** No fill, no probe that calls the Odds API.

Task 6 of `docs/CC-CMD-2026-09-18-atomic-odds-counter.md`, plus the Whoop
removal the owner asked for mid-session.

## The CC-CMD is closed

| task | state | where |
|---|---|---|
| 0 probe | done — `returning-supported` | `outbox/d1-returning-probe-20260919T180132Z.log` |
| 1 schema | done — `ARCHIVE_DB`, not the `DB` specified | `36878b9` |
| 2 guard | **done, live** — one batch, four KV ops replaced | `5edb19a`, deploy run 980 |
| 3 "two owner decisions" | superseded — both were measurements | `3911c87` |
| 4 cutover | folded into 2 — the KV-seeded row removed the day-boundary requirement | `5edb19a` |
| 5 mutations | done — 8/8, three executing real SQL | `5edb19a` |
| 6 manifest | this document | — |

**Deploy run ID:** 980 (`workflow_dispatch`, head `587fa48`), all 113 steps and
the 16-step verify job green.

### Done-condition output, verbatim

`odds_budget_charging`, first run after the guard went live
(`outbox/staged-verification-20260919T191815Z.json`):

    odds_budget_charging         PASS
        tables_exist:   True
        d1_used_today:  2941
        kv_used_today:  2941

The two stores equal to the credit is the KV seed working: the day's existing
total carried into the first `INSERT OR IGNORE`, so a mid-day cutover produced
no double count and did not hand the day a second ceiling.

### The done condition itself was rewritten, and that is the finding

The original two conditions both measured `used` against `by_site_sum`. After
Task 2 those numbers are written by the same batch over the same rows — **they
agree because the schema says so.** Waiting three days for them to go green
would have been waiting for a tautology, and pasting it here would have
published one as evidence.

Replaced by `odds-daily-vs-vendor` returning `tracks-the-bill` on three closed
days: the only remaining check with an external referent. **Genuinely pending**
— the first firing is 2026-09-20 00:10Z plus the measured 104-405 min delay, and
three closed days puts a verdict around 09-22. Not claimed as done.

## Five defects, all mine, all caught by the apparatus rather than by reading

1. **The Task 1 staged claim had no verifier**, which took `deploy.yml` red at
   step 76 and left **two commits undeployed**, including the Whoop removal.
   Fixed with a real executor (`odds_budget_charging`), not a reworded marker.
2. **Task 2's deploy died at step 50**, a grant assertion text-matching a JS
   comparison Task 2 had moved into SQL. Re-anchored to where the invariant now
   lives; mutation R4 still bites.
3. **Two mutations survived first time** (B4/B5): the self-test exercised two
   predicates directly and never asked `verdict()` what it did with them. Third
   instance this session of checking the value and not the branch.
4. **`mixedStore` added to `deltas` but not to the `usable` filter** — a
   straddling interval would have been counted while looking handled. Found by
   writing mutation D11 before trusting the change.
5. **Two mutations reported `anchor matched 0 times — NOTHING MUTATED`** because
   I appended arrays to a harness taking named-key objects. It refused to report
   a verdict it had not produced. Rule 90's corollary, working.

I also ran only the gates I had touched rather than the gates `deploy.yml` runs,
which is how (2) reached CI. The gate list is now extracted from the workflow:
**67/67 pass locally.**

## Whoop, removed on request

3 routes, a 143-line block, both `[vars]` entries, 3 provenance entries. Zero
references in jubilant-bassoon, named in no contract.

**The cost was not the dead code.** `WHOOP_CLIENT_SECRET` sat in `[vars]` in
`wrangler.toml` — tracked, in a repo GitHub reports as public, deployed as a
plaintext env var — from the commit that added the feature.
`check-exposed-secrets` passed throughout; its ratchet did not know that
credential existed. The owner rotated it before anything landed.

It was also the **only** consumer of the `DB` binding, which is what made `DB`
look like a live database and led the CC-CMD to specify it for the odds budget.

`scripts/check-no-foreign-domain.mjs` now asks the question none of the forty-odd
guards asked: not *is this code correct* but *does it belong*. A declared list
with a date and a reason per host, not a classifier. It caught a reference my own
`git grep | head -20` had truncated away.

## Residuals — genuine, not deferred work

1. **`batch()` atomicity is unverified.** The `node:sqlite` mutations are
   sequential and prove the statements correct *given* a transaction.
   `odds-site-drift` is now the instrument for it — re-scoped, not retired, and
   its output states which claim its green is making.
2. **The route-provenance generator attributes hostnames across route
   boundaries.** Proven by restoring the pre-removal `index.js` and re-running
   it: four sports routes named `api.prod.whoop.com`. Removing Whoop made it
   unobservable, not absent. Reproduction in
   `outbox/2026-09-19-whoop-removal.md`. Its own commit; not fixed here.
3. **Task 0d latency is unmeasured.** The op count is 4 → 1; whether that is
   faster is not claimed.
4. **The `DB` binding and the `whoop_tokens` table** are both unreferenced and
   both left alone — a binding change needs owner approval, and dropping a table
   is a live D1 mutation.

## What did NOT move

The `-410` and the **685 unexplained credits** are untouched. Those are the
ledger-vs-vendor gap; Task 2 addressed the daily-vs-site gap. Reading "Task 2
shipped, the gap closed" would be reading the wrong gap — the substitution this
CC-CMD's own history keeps making.
