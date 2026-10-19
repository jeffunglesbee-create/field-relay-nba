# CC session — the odds guards on the deploy path, and a wrapper check that runs the wrapper, 2026-10-19

`docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md`, option (a), with
finding 4 closed as well (from option (b)).

**HEAD:** `16da2eb5` → `796bb8a6` (11 work commits, 2 pushes).
**Deploy runs, both green with every odds step:**
- 39235572012, on `f4b4e5eb`, after the first push;
- **39242815269, on `796bb8a6`, the final one.**

## TASK 0: each premise, one command

| premise | command | result |
|---|---|---|
| one wrapper per file | `grep -c "async function consumeOddsCredit(\|async function _consumeAmbientOddsCredit(" src/*.js` | index 1, wp-resolver 1, ambient-do 1 |
| bodies read `return chargeOdds(env, units, site);` | `grep -n` | `index.js:6761`, `wp-resolver.js:210`, `ambient-do.js:1161` |
| the nine guards are guards.yml-only | `grep -c scripts/<s>.mjs` per workflow | all nine: guards ≥ 1, deploy 0 |
| check-monthly-atomic rejects the Done-2 rewrite | `INDEX_SRC=<rewrite> node scripts/check-monthly-atomic.mjs` | `86 of 87 passed`, rc 1 |
| node:sqlite on the runner | (answered in the CC-CMD) guards run 39180185016 | green |

## What landed

| commit | what |
|---|---|
| `e03299e7` | the wrapper check accepts equivalent spellings (superseded by `f0aa4e94`) |
| `22cf21c5` | the gate ignores whole-line comments when crediting a guard (superseded by `118ece95`) |
| `a1fe2aac` | **deploy.yml runs the nine odds guards** before "Deploy to Cloudflare Workers"; the guards.yml header is corrected |
| `3f7d35f4` | the monthly-atomic mutants find the delegation by shape (superseded by `f0aa4e94`) |
| `f4b4e5eb` | `scripts/mutate-deploy-odds-wrappers.mjs`, the deploy-path harness |
| `f0aa4e94` | **the wrapper check RUNS each wrapper against a stub chargeOdds.** The mutate harness swaps whole wrappers. 32 of 32 mutants caught; 6 of 6 equivalents green |
| `118ece95` | **the gate blanks comments and strings, string-aware, and credits only a guard whose verdict is used** |
| `73bc5a02` | check-odds-live-disabled's M4 finds the charge line by shape |
| `f4e41910` | **three more odds guards on the deploy path** (wc-lambdas-gated, reconcile-tally, script-created-tables); the other six src-only guards filed |
| `f63cf4ba` | the harness reads HEAD's deploy.yml, needs a green control, and never counts a kill as a catch |
| `796bb8a6` | the mutation log |

## Done conditions

1. **Each mutant turns deploy.yml red.** See
   `outbox/odds-gate-deploy-mutation-2026-10-19.log`.
   - The control is green.
   - 9 of 9 mutants are caught, 3 per wrapper:
     - `return true;`
     - the charge runs, then `return true;`
     - the one-`!` early return
   - Each turned "the monthly charge is atomic and its ceiling binds" red.
   - The 25 odds steps were read from HEAD's deploy.yml and are listed in
     the log.
2. **The equivalent rewrite stays green.**
   `const charged = await chargeOdds(env, units, site); return charged;`
   leaves all 25 odds steps green, on all three wrappers.
3. **One real deploy.yml run is green on the commit:** run 39242815269 on
   `796bb8a6`. All 13 odds steps succeeded: the gate, the nine, and the
   three added by census.

## What the session's own measurement and review changed

- **The harness's first run found the deploy blocked on correct code.** The
  three equivalent rewrites went red in `mutate-monthly-atomic`, which
  anchored its wrapper mutants on the exact line. That is the defect the
  CC-CMD recorded against the dropped version. It was reproduced, and fixed
  before the push.
- **The adversarial review** (three lenses, `wf_f4f59d9b-92f`) returned 13
  findings, all fixed:
  - **Two high, reproduced on all three wrappers.** The text-based wrapper
    check passed `x = true; return x;`, a log-and-allow
    `if (!charged) return true;`, and an early return. Deleting one `!` from
    `if (!env || !env.FIELD_JOURNALISM) return true;` makes every production
    call return true and charge nothing. All of these passed the 22 odds
    steps. The fix is to run the wrapper, not read it.
  - **Medium:**
    - the gate credited a guard called with its verdict ignored;
    - two exact-text self-test anchors on the deploy path;
    - three src-reading odds guards missed by the CC-CMD's filename regex;
    - the harness read the working-tree deploy.yml while testing HEAD.
  - **Low:**
    - finding 4 was still open for block, trailing and string comments;
    - a red control changed nothing;
    - a kill was counted as a catch;
    - the coverage line was a fixed string;
    - the push alone could not run deploy.yml (a dispatch was needed, and
      done).
  - **Refuter pass, CORRECTED.** This bullet first read "4 confirmed real
    and 1 refuted at the time of writing ... a later refutation can only mean
    a fix was unnecessary, not that a gap is open." The final pass refuted
    that sentence. Final tally: 5 real, and 8 that no longer reproduced at
    `796bb8a6` because they were already fixed. But two of the 5 real
    verdicts found the fix incomplete at `796bb8a6`. The chat report "all 13
    fixed" was wrong. See "Correction" below.
- **Rule 90 on each new mechanism.** Reverting it turns its own cases red:
  - the executed wrapper test: X1, X2, X3 and X5 passed the text check;
  - the comment/string scanner: 3 gate fixtures;
  - the used-verdict rule: 1 gate fixture;
  - shape-based M4: the old M4 fails a reformat that the new one passes.

## Correction — two residuals, fixed the same day (`293ffcf6..1cca6b40`)

The first review's final verdicts arrived after this doc was committed. Two of
its real findings were only partly fixed at `796bb8a6`. Both were reproduced at
`ca3e4540` before any change: the control was green, and all five mutants came
out wrong.

- **A hole (money).** The `/odds/*` proxy, the one public billable route, was
  checked by name only. A negated verdict also counted with nothing exiting.
  Three mutants each left both deploy-path checkers at rc 0:
  - P1, the proxy charges and drops the verdict;
  - P2, the proxy's refusal only logs;
  - L1, wp-resolver's refusal only logs.
- **False reds.** Two correct rewrites of the ambient live poll's charge
  blocked the deploy:
  - A1, the cost hoisted into a const;
  - A2, the 133-character call wrapped.
  check-odds-live-disabled still matched the charge by exact text, and the
  finding-4 self-test needed the site label on the guard line.

| commit | what |
|---|---|
| `293ffcf6` | the comment/string blanker moves to `scripts/lib/blank-comments.mjs`, shared by both checkers |
| `9857ce31` | the finding-4 live self-test finds the guard inside `_fetchLiveOdds`, not by its label |
| `584207a5` | **a guard counts only if its refusal ends in `return`/`throw`, and the proxy is held to the same rule.** Every live guard site is made log-only as a self-test: 9 of 9 caught |
| `e2d83843` | **check-odds-live-disabled finds the guard, the charge and the declaration by shape, in code, inside `_fetchLiveOdds`.** Correct rewrites stay clean, and copies in comments, strings or the next method do not count. 14 of 14 |
| `1cca6b40` | the deploy harness also edits guard sites in place: 3 must stay green, 4 must go red |

**Proof:** `outbox/odds-gate-residuals-2026-10-19.log`.
- Before the fix, at `ca3e4540`: 5 of 5 mutants WRONG.
- Rule 90 on the new checker logic: 10 of 10 mutations caught, control green.
- Deploy harness: 19 of 19 cases as expected over the 25 odds steps, control
  green. 13 mutants were caught, and 6 equivalents stayed green, including A1,
  A2 and the guard written with braces.
- The harness ran at `79b17ebc`, before the rebase.
  `git diff 79b17ebc 1cca6b40 -- src scripts .github` is empty.
- **Deploy run 39274421945 on `1cca6b40`: success**, every odds step included.
  Repo guards run 39274411014 also succeeded.

**The second review** (`wf_710edc9e-6f5`, three lenses at `79b17ebc`):
- 20 findings came back. The owner stopped it when 7 of its 12 verifiers had
  returned, all 7 real, and asked for the findings as small separate tasks.
  None says these commits made anything worse.
- **Defects in today's own code, now filed:**
  - `verdictTests()` searches the whole file for a named verdict's `!x`, which
    is a false red on a guard named `ok`;
  - the fixture "a verdict inside a compound condition IS a guard" encodes a
    hole: any `X && !(await G(...))` is credited.
- Filed as three CC-CMDs, each self-contained:
  - `docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md`: nothing checks that
    the guard runs before the fetch. Three lenses found this independently.
  - `docs/CC-CMD-2026-10-19-odds-gate-false-reds.md`: 8 rows of correct
    rewrites that still block the deploy.
  - `docs/CC-CMD-2026-10-19-odds-guard-condition-and-exit.md`: a conjunct in
    front of the verdict, a refusal path that still fetches, helper-built
    calls the scan cannot see, and three low ones.

## Filed, not done here (Rule 87.4)

`docs/CC-CMD-2026-10-19-guards-only-src-readers.md`. A census found six more
guards.yml-only steps that read `src/`, outside the odds scope:
- relay secret gates (security-relevant);
- foreign domains;
- provenance shadowing;
- NHL on-ice;
- hockey WP;
- BSD frames (needs network).

The guards.yml header now states this measured fact instead of a rule it
broke.

## Integration state (Rule 65)

No relay contract changed. CI only; `src/` is untouched. Deploy time added by
the 12 new odds steps on the runner: 4 s in total, measured from run
39242815269's step timestamps.
