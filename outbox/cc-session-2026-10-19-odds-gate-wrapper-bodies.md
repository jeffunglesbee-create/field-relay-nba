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
  - **Refuter pass:** 4 confirmed real and 1 refuted (the push/dispatch one,
    already handled) at the time of writing. The rest were still running.
    Every finding was fixed as reported, so a later refutation can only mean
    a fix was unnecessary, not that a gap is open.
- **Rule 90 on each new mechanism.** Reverting it turns its own cases red:
  - the executed wrapper test: X1, X2, X3 and X5 passed the text check;
  - the comment/string scanner: 3 gate fixtures;
  - the used-verdict rule: 1 gate fixture;
  - shape-based M4: the old M4 fails a reformat that the new one passes.

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
