# Claude Code Command — the deploy-path odds gate trusts a wrapper's name

**Date:** 2026-10-18
**Repo:** field-relay-nba
**Branch:** main. Commit directly; do not create a feature branch or a PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
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
   - At `ee819563`, `return chargeOdds(env, units, site);` was replaced the
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
     chargeOdds, with its site`). 22 odds and budget checks were run on the
     clean and mutated commits; it was the only one to flip.
   - It runs only in `guards.yml`. That workflow has `paths-ignore: src/**`,
     so a push that touches only src runs `deploy.yml` and skips it.
4. **A guard name inside a comment counts.** The gate does not strip
   comments. `src/ambient-do.js:638` (at `b5a95e7c`) reads
   `// consumeOddsCredit() — same KV key scheme`.

## Two defects in the dropped version, so a rebuild does not repeat them

- **Its live self-test anchored on exact text.** The rewrite
  `const charged = await chargeOdds(env, units, site);\n  return charged;`
  behaves identically, but it failed the gate with `live mutation anchor
  matched 0 times — NOTHING MUTATED`. That is a deploy blocked on correct code.
- **Its `stripLineComments` cut string contents.** On a line holding
  `" //"` inside a string, it stripped from the `//` onward. That removed a
  guard call on the same line, a false red.

## TASK 0 — probe the premises, one command each (Rule 100)

1. Does `check-monthly-atomic.mjs` run on the deploy runner?
   - It imports `node:sqlite`, which needs Node 22.5 or later.
   - `deploy.yml` has no `setup-node` step, so the runner's default Node
     applies.
   - Probe: a one-step dispatch that prints `node --version` and runs
     `node -e "require('node:sqlite')"` on `ubuntu-latest`.
2. Is there one wrapper per file? `grep -c "async function consumeOddsCredit(\|async function _consumeAmbientOddsCredit(" src/*.js`.
3. Do the wrapper bodies still read `return chargeOdds(env, units, site);`? Probe: `grep -n "return chargeOdds(env, units, site);" src/*.js`.

## TASK 1 — the choice, with its reason

- **(a) Recommended: run `check-monthly-atomic.mjs` in `deploy.yml`**, beside
  `check-odds-calls-guarded.mjs`, as long as TASK 0.1 shows `node:sqlite`
  loads.
  - It adds no new matcher. The W-checks that already catch findings 1 and 2
    run on the path that deploys.
  - If `node:sqlite` does not load, add a `setup-node` step pinned to 22 in
    the same commit.
- **(b) Harden `check-odds-calls-guarded.mjs` itself**, so that the wrapper
  must return chargeOdds's verdict.
  - It must accept `const x = await chargeOdds(...); return x;`.
  - Its self-test must mutate whatever `chargeOdds(` call it finds, not one
    exact text.
  - It needs a string-aware comment stripper, or none.

(a) and (b) are not exclusive. (a) alone closes findings 1 and 2. Finding 4
stays open under (a), but it can only make a gate pass for a site that names
the wrapper in a comment and spends without calling it. The `BILLED` scan
would still flag that site's URL as unguarded.

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
