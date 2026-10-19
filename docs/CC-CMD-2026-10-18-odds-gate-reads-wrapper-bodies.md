# Claude Code Command — the deploy-path odds gate trusts a wrapper's name

**Date:** 2026-10-18
**Repo:** field-relay-nba
**Branch:** main. Commit directly; do not create a feature branch or a PR.
**Confidence gate:** >= 95 before any commit
**Status:** **DONE 2026-10-19.** Option (a) landed, with finding 4 closed (from option (b)). The wrapper check now runs each wrapper against a stub, so it no longer reads text. Twelve odds guards are on the deploy path. Done 1 and 2: `outbox/odds-gate-deploy-mutation-2026-10-19.log` (9 of 9 mutants caught, 3 of 3 equivalents green, control green). Done 3: deploy run 39242815269 on `796bb8a6`, green. Session doc: `outbox/cc-session-2026-10-19-odds-gate-wrapper-bodies.md`. Follow-up filed: `docs/CC-CMD-2026-10-19-guards-only-src-readers.md`. **Correction, same day:** two findings of this CC-CMD's own review were only partly fixed at `796bb8a6`. One was a hole: the `/odds/*` proxy passed with its verdict dropped, and a refusal that only logs counted as a guard. The other was false reds on two correct rewrites of the live-poll charge. Both were closed in `293ffcf6..1cca6b40`, with deploy run 39274421945 green and proof in `outbox/odds-gate-residuals-2026-10-19.log`. The second review's findings are filed as `docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md`, `docs/CC-CMD-2026-10-19-odds-gate-false-reds.md` and `docs/CC-CMD-2026-10-19-odds-guard-condition-and-exit.md`.
**Filed by:** CC, from the 2026-10-18 adversarial review of option 1 in
`docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`. The hardening
was briefly on that branch. It was dropped under Rule 69 because option 1 did
not need it: the `b5a95e7c` gate passes on the option-1 source unchanged. This
document is Rule 87.4's second CC-CMD for that dropped work.

---

## What was measured, 2026-10-18, in scratch copies (no tracked file edited)

1. **A gutted wrapper passes the deploy gate.**
   - At `b5a95e7c`, `return chargeMonthlyOdds(env, units);` in `src/index.js`
     `consumeOddsCredit` was replaced by `return true;`.
   - At the single-batch commit ("fix: charge the day, the site and the month
     in one D1 batch"), `return chargeOdds(env, units, site);` was replaced the
     same way.
   - Both times `node scripts/check-odds-calls-guarded.mjs` printed `PASS —
     every odds call is charged to the monthly ledger` with rc 0.
   - The gate credits a billed site to a wrapper by its NAME. The gap predates
     option 1, which neither opened it nor widened it.
2. **A discarded verdict passes too.** The edit
   `await chargeOdds(env, units, site);\n    return true;` in
   `src/wp-resolver.js` or `src/ambient-do.js` passes the gate, and it also
   passes the hardened version that was dropped. An end-to-end harness, with
   the day held at the ceiling, measured this:
   - clean source: `{ok:false, guarded:true}`, 0 vendor calls;
   - mutated source: `{ok:true}`, 1 vendor call, no counter moved.
3. **Only one check catches either case, and it is off the deploy path.**
   - `scripts/check-monthly-atomic.mjs` catches both (`FAIL ... delegates to
     chargeOdds, with its site`). **Checked 26 of the 27 odds and budget check
     scripts** (the 27th calls the Cloudflare API), on clean source and with
     each wrapper reduced to `return true;`. Only check-monthly-atomic.mjs
     changed rc, for each of the three wrappers:
     `outbox/odds-gate-wrapper-sweep-2026-10-19.log`.
   - It runs only in `guards.yml`. That workflow has `paths-ignore: src/**`,
     so a push that touches only src runs `deploy.yml` and skips it.
   - **It is not alone.** Nine odds guards run only in `guards.yml`, with no
     copy in `deploy.yml`:
     - check-degrade-open-reason
     - check-batch-order
     - check-odds-live-disabled
     - check-odds-budget-schema, with its mutate script
     - check-monthly-atomic, with its mutate script
     - check-monthly-counter-writers
     - check-ceiling-reached, with its mutate script
     - check-odds-budget-batch, with its mutate script
     - watch-odds-pairing-rate --self-test

     A src-only commit that reverted the single batch's veto fixes would deploy
     with every runnable gate green. `guards.yml` lines 22-23 say "on a
     src-only push this job does not run and deploy.yml's copies do". That is
     true only of the guards that have copies. Removing `paths-ignore` would
     not close the gap: `guards.yml` is a separate workflow, and `deploy.yml`
     would still deploy in parallel without waiting for it.
4. **A guard name inside a comment counts.** The gate skips `//`-led lines
   when it looks for billed URLs, but not when it credits a guard. So a
   trailing comment naming the wrapper satisfies it. `src/ambient-do.js:638`
   (at `b5a95e7c`) reads `// consumeOddsCredit() — same KV key scheme`.

## Two defects in the dropped version, so a rebuild does not repeat them

- **Its live self-test anchored on exact text.** The rewrite
  `const charged = await chargeOdds(env, units, site);\n  return charged;`
  behaves identically, but it failed the gate with `live mutation anchor
  matched 0 times — NOTHING MUTATED`. That is a deploy blocked on correct code.
- **Its `stripLineComments` cut string contents.** On a line holding
  `" //"` inside a string, it stripped from the `//` onward. That removed a
  guard call on the same line, a false red.

## TASK 0 — probe the premises, one command each (Rule 100)

1. Does `check-monthly-atomic.mjs` run on the deploy runner? **Already
   answered.**
   - It imports `node:sqlite`, which loads unflagged from Node 22.13.
     Versions 22.5 to 22.12 need `--experimental-sqlite`.
   - `guards.yml` runs it on `ubuntu-latest` with no `setup-node`, and it is
     green: run 39180185016, step "the monthly charge is atomic and its
     ceiling binds": success.
   - `deploy.yml` uses the same `runs-on: ubuntu-latest` with no
     `setup-node`, so the same default Node applies.
2. Is there one wrapper per file? `grep -c "async function consumeOddsCredit(\|async function _consumeAmbientOddsCredit(" src/*.js`.
3. Do the wrapper bodies still read `return chargeOdds(env, units, site);`? Probe: `grep -n "return chargeOdds(env, units, site);" src/*.js`.
4. Does check-monthly-atomic accept the Done-2 rewrite? Write
   `const charged = await chargeOdds(env, units, site);\n  return charged;`
   into one wrapper in a scratch copy, run
   `node scripts/check-monthly-atomic.mjs`, and expect rc 0. **At the time of
   filing it is rc 1.** Its W-check (`/return chargeOdds\(env, units, site\);/`)
   matches exact text, the same defect as the dropped version's self-test.

## TASK 1 — the choice, with its reason

- **(a) Recommended: run the nine guards listed under item 3 in `deploy.yml`**,
  before the deploy step, copied from `guards.yml`.
  - **In the same commit, widen check-monthly-atomic's W-check** so that
    TASK 0.4's rewrite passes. Otherwise (a) blocks a deploy on correct code,
    which Done condition 2 forbids.
  - One measured form accepts `return [await] chargeOdds(env, units, site);`,
    or `const x = await chargeOdds(env, units, site);` followed by
    `return x;`.
  - Add a mutation that turns the widened check red (Rule 90).
  - Then correct `guards.yml` lines 22-23.
- **(b) Harden `check-odds-calls-guarded.mjs` itself**, so that the wrapper
  must return chargeOdds's verdict.
  - It must accept `const x = await chargeOdds(...); return x;`.
  - Its self-test must mutate whatever `chargeOdds(` call it finds, not one
    exact text.
  - It needs a string-aware comment stripper, or none.

(a) and (b) are not exclusive. (a), with the W-check widened, closes findings
1 and 2.

Finding 4 stays open under (a). A site that names the wrapper in a comment and
spends without calling it passes both `check-odds-calls-guarded.mjs` and
`check-monthly-atomic.mjs`. Measured by the 2026-10-19 review: with the one
guard call in `src/ambient-do.js` `ambientFetchLiveOdds` removed, the comment
at :638 still credits the site (`ok src/ambient-do.js:635 [billed]`, PASS). Of
deploy.yml's checks, only `check-odds-attribution.mjs` goes red, and only
because the removed call also carried the site label.

If (b) is taken, its comment handling must close finding 4. Add a Done mutant:
delete that guard call, keep the :638 comment, and the guard step must go
red.

## Done condition (Rule 89 artifacts)

1. **Each mutant turns `deploy.yml` red.** Apply each of these to each of the
   three wrappers:
   - `return true;`
   - `await chargeOdds(env, units, site);\n    return true;`

   Each must turn `deploy.yml`'s guard step red, with the step name in the
   output. Show it with a mutation run whose anchors are asserted unique and
   applied (Rule 90's harness corollary). Commit the log.
2. **The equivalent rewrite stays green.** The rewrite
   `const charged = await chargeOdds(env, units, site);\n  return charged;`
   must leave that step green.
3. **One real `deploy.yml` run is green on the commit**, with its run id
   recorded.

## FORBIDDEN

- No credits.
- No change to counter arithmetic or routing.
- Do not loosen or remove `check-odds-calls-guarded.mjs`'s existing checks.
