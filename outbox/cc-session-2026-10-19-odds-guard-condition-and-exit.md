# CC session — the odds guard's condition and its refusal path, 2026-10-19

`docs/CC-CMD-2026-10-19-odds-guard-condition-and-exit.md`, dispatched by the owner.
It is the second of the three small CC-CMDs filed from the second odds-gate
review. The first, guard-before-fetch, closed earlier today.

**HEAD:** `323990ea` → `1e0bfb80`, with 6 work commits, then one docs commit.
They were rebased onto `a3a27cb6`, an upstream census commit touching only
outbox/, before the push. The pre-rebase SHAs named in the harness runs and
in three commit messages map as follows:
- `4827946e` → `8b2b9909` (harness);
- `4d859c06` → `f32b37c4` (task 1);
- `d3680caa` → `4457152c` (task 2);
- `242ab107` → `4e230ef5` (task 3);
- `db547e6b` → `6aadef9c` (task 4, kill switch);
- `55d72c3d` → `1e0bfb80` (task 4, blanker).

`git diff 55d72c3d 1e0bfb80 -- src scripts .github` is empty.
**Deploy run:** 39294330163 on `1e0bfb80`, success (deploy and verify jobs); Repo guards run 39294330159 also success.
**Proof:** `outbox/odds-guard-condition-and-exit-2026-10-19.log`

## TASK 0 — premises, one command each (Rule 100)

| premise | command | result |
|---|---|---|
| every live guard condition already has an exact shape, so a strict rule blocks no correct code | condition probe over the 9 sites (log §1) | **true.** Eight are `!(await G(...))`; the proxy is `oddsBillablePath(cleanPath) && !(await G(...))`. No site names its verdict |
| P3, S3 and R1 pass the deploy path | harness `--only=[ce]` at `323990ea`, all 25 odds steps (log §2) | **true**, all NOT CAUGHT. So are two more shapes in the same class, written for this run: R2 (`const ok = await G() \|\| flag`) and S6 (`!(await G() \|\| flag)`) |
| task 2's P4 and E7 need a rule of their own | the same run | **false.** Both were CAUGHT through all 25 steps by the ordering rule (`4b4a987c`). No rule was added; the reason is written beside `consequentExits` |
| N1, a helper-built call, passes | the same run | **true**, and so does N2 (through `oddsFetchWithFallback`) |
| K1, the shadowed kill switch, passes | the same run, then `findings()` called directly | **the deploy went red, for the wrong reason.** `findings()` returned `[]`; only self-test M2's own assertion broke on the second declaration |
| the regex-literal hole can credit a guard that is gone | X1 at `4827946e` from a fixed worktree, and the gate run directly at `323990ea` | **true** for a guard commented out on one line (NOT CAUGHT). The first, three-line X1 was red for an incidental reason: the `//` markers, kept as code, broke the consequent |
| 20 lines of src/index.js blank differently from acorn | acorn's tokenizer against the blanker (log §6) | **20 under the old contract**, where regex bodies are kept. 265 under the contract this commit uses, where regex bodies are blanked |
| N1 is the only risk the helper scan would find | the widened scan, run on HEAD's source | **false.** It found a real unlabelled site: `oddsProviderQuota`'s `/v4/sports` call through `oddsFetchWithFallback`, which no check could see |

## What landed, one commit per task

| commit | task | what |
|---|---|---|
| `8b2b9909` | — | 14 deploy-path harness cases tagged `[ce]`: 11 must-red, 3 must-stay-green. The COVERAGE line tallies the two new-call cases (N1, N2) apart from the guard sites |
| `f32b37c4` | 1 | a condition is credited only when it is exactly `!(await G(...))`, or `!x` with `x` the nearest same-block `const x = await G(...);`, or, at the proxy only, `oddsBillablePath(cleanPath) && !(await G(...))`. The fixture that encoded the hole now expects red |
| `4457152c` | 2 | **decided: no rule of their own.** P4 and E7 fixtures hold the ordering rule to them, and the reason is written beside `consequentExits` |
| `4e230ef5` | 3 | **decided: widen the scan.** Every `oddsUrl` / `oddsFetchWithFallback` call is now a site, with `EXPECTED_HELPER_SITES = 2` and a SCOPE line naming what is still unseen. `oddsProviderQuota` gains its ODDS-FREE note (8 comment lines in src/index.js) |
| `6aadef9c` | 4 | **decided: fix.** A second `ODDS_LIVE_PATH_404` declaration is a finding |
| `1e0bfb80` | 4 | **decided: fix.** `scripts/lib/blank-comments.mjs` reads regex literals; against acorn, 0 lines differ in the three checked files, down from 265 |

## Done conditions (Rule 89)

1. **Every task's mutants are CAUGHT in a committed harness log.**
   **39 of 39 as expected at `55d72c3d`**, control green first (log §8):
   - 30 mutants CAUGHT: the 19 from earlier sessions and the 11 new ones.
     Each new case went red at the step it should: K1 at "the odds-live 404
     path returns before the charge", the other ten at "Every odds call is
     charged to the monthly ledger";
   - 9 equivalents green, 3 of them new.
   Before the fixes, 7 of the 11 new mutants (8, counting X1's one-line
   form) were NOT CAUGHT (log §2).
2. **Reverting each fix turns its own fixture red** (Rule 90, log §5).
   | task | mutations | caught |
   |---|---|---|
   | 1, exact condition | old rule back, trailing operand, `let` allowed, same-block check dropped, proxy conjunct everywhere, conjunct negatable, initializer loosened | 7 of 7 |
   | 2, held by ordering | ordering unchecked, containment dropped, fetch inside the refusal allowed | 3 of 3 |
   | 3, helper scan | not scanned, nested call counted alone, definition counted, `some` for `every`, proxy judged as ordinary, ODDS-FREE not required | 6 of 6 |
   | 4, one declaration | the rule removed | 1 of 1 |
   | 4, regex blanker | not recognised, every `/` a regex, keywords ignored, class `/` ends it, escapes not skipped | 5 of 5 |
   | guard-before-fetch, re-run | the 5 ordering-rule mutations | 5 of 5 |
3. **Live self-tests on the real source**, all in check-odds-calls-guarded:
   - log-only 9 of 9;
   - moved below the fetch 9 of 9;
   - an env flag put in front of the verdict 9 of 9 (new);
   - the free helper site made billed 1 of 1 (new);
   - 62 of 62 self-tests, and check-odds-live-disabled 16 of 16.
4. **Deploy:** run 39294330163 on `1e0bfb80`, success. Every odds step passed, the Cloudflare deploy ran, and the live verify job passed.

All 96 runnable pre-deploy steps of deploy.yml pass at `55d72c3d`. One was
red in my first run, because its checkout directory must be named
`field-relay-nba` and my temp copy was not. It is green in a copy with that
name, at HEAD and at origin/main.

## What this session got wrong, and the cost

- **Two unpushed commit messages named the wrong reproduction SHA.** They said
  `4827946e`; the `--only=[ce]` run was at `323990ea`. The checkers are
  identical at both, so no result changes. Both messages were corrected
  before the push, and the trees did not change.
- **X1's first form proved nothing.** It was caught, but because the comment
  markers broke the consequent, not because the guard was credited. It was
  rewritten on one line, and the rerun was repeated from a worktree fixed at
  `4827946e`, because the first rerun straddled a commit.
- **Two blanker fixtures could not tell their mutation apart.** "Every `/` a
  regex" was caught only by live sites going red, and "a class `/` ends the
  regex" was not caught at all: a stray `]` broke bracket matching and gave
  the expected red for the wrong reason. Both fixtures were replaced with ones
  that bite on their own.

## Limits, printed with the result (Rule 91)

check-odds-calls-guarded now ends with a SCOPE line. It says:
- not seen: a vendor URL built by any other function, or passed in from
  elsewhere;
- fetch-like calls are `fetch`, `relayFetch` and `oddsFetchWithFallback`
  only;
- so a refusal that calls another helper which fetches is also not seen.

check-odds-live-disabled counts `const`/`let`/`var` declarations only, not
parameters. Both limits are written beside the code.

## Integration state (Rule 65)

- CI only, plus 8 comment lines in `src/index.js` (`oddsProviderQuota`'s
  ODDS-FREE note); `node --check` passes.
- No relay contract changed; no client consumer is affected.
- check-odds-calls-guarded's runtime went from 1.80 s to 2.81 s, best of 3
  in this sandbox (`323990ea` vs `1e0bfb80`). Most of the rise is the new
  live self-tests, each re-scanning a guard's file once per site.

## Left for the other filed CC-CMD

`odds-gate-false-reds` stays FILED. Two of its rows touch this work, and its
own status line records both:
- **Row 2:** the `!x` search runs to the end of the file. That now applies to
  the new "conjunct" live self-test as well.
- **Row 8:** `if (!await G(...))` without parentheses is still red. The exact
  condition accepts `!(await G(...))` only.
