# Claude Code Command — correct rewrites that still block the deploy

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** CC, from the second adversarial review of the odds gate
(`wf_710edc9e-6f5`, 2026-10-19, against `79b17ebc` = pushed `1cca6b40`). It was
stopped by the owner, and these are its false-red findings. A false red is a
behaviour-preserving edit that turns a deploy-path odds step red. It blocks a
deploy on correct code, which is the defect class
`docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md` names.

**Rows 2-5 are in code changed on 2026-10-19.** Row 2's defect is new with that
change. Rows 3-5 were the same, or narrower, before it. Each row is its own
task with its own fix and mutation; take them one at a time, in order.

---

| # | where | the false red | fix (reviewer's, to be re-probed) |
|---|---|---|---|
| 1 | `scripts/mutate-odds-attribution.mjs`, inside deploy step "Every odds call names which consumer spent it" | mutations A1, A2, A3, A7 and A9 anchor on exact text such as `oddsCreditCost(_liveUrl), 'fetchSportOddsLive')`. Hoisting the cost into a const (`fetchSportOddsLive` already computes `_est` on the next line) or wrapping the call prints NOTHING MUTATED, rc 1 | find the anchors by shape with `callsOf()` from check-odds-attribution.mjs and rewrite the site argument. Add F1, F2, G1 and G2 to the deploy harness as must-stay-green |
| 2 | `check-odds-calls-guarded.mjs` `verdictTests()` | the `!x` search for a named verdict runs to the end of the FILE, so the live log-only self-test mutates unrelated `if (!ok)` statements (index.js has them at 6858, 6997, 15762) and fails. Naming a verdict `ok`, the name the checker's own fixture uses, blocks the deploy | limit the search to the enclosing function. Add a fixture with an unrelated later `if (!ok) continue;` that must stay green |
| 3 | `check-odds-live-disabled.mjs --self-test` | `M()`, M4 and M6 assert anchor uniqueness on RAW text, comments included. A comment quoting the guard, the declaration or `/odds-live?apiKey=` turns the step red. M6's `.replace` can edit the comment copy, and M3 drops the NOT UNIQUE reason from its output | mutate by offset from `locate()`. Assert that M6's replacements match once, and print M()'s reason as the detail |
| 4 | `check-odds-calls-guarded.mjs` `proxyGuarded()` **(the window half was DONE on 2026-10-19 by `4b4a987c`: the block is now read to its closing brace, with a self-test that a 2000-char comment after the head stays green. The raw `indexOf` of the head is still open)** | it finds the proxy with a raw `indexOf` of one exact head, and reads a 1600-char window. A comment quoting the head earlier in index.js, a double-quoted head, or a comment longer than about 818 chars inside the block each turn the step red. The guard's consequent closes at window offset 781 | match the head by shape in blanked code. Assert one match, and bound the block by brackets |
| 5 | `check-odds-live-disabled.mjs` `GUARD_RE` | only `return` and `{ return; }` count. Logging then returning, `return undefined`, `=== true`, or merging into `if (!apiKey)` all read as "guard missing". `'/odds-live?apiKey='` also misses a reordered query, and that is a false GREEN too: reorder it and delete the guard, and the check passes | reuse `enclosingIf`/`consequentExits`, moved to scripts/lib, and match the URL with `/\/odds-live[?`]/` |
| 6 | `consequentExits()` / `closeOf()` | a refusal log in a template literal with an unbalanced bracket, or an if/else whose arms both return, reads as "does not exit" | treat template text as opaque in the bracket walk, and accept an if/else whose arms all exit |
| 7 | check-odds-reconciled, and check-odds-calls-guarded's BILLED scan | line scans skip only `//` lines, so a JSDoc or `/* */` naming the guard or the vendor URL counts as code | run them over `blankCommentsAndStrings(src).split('\n')` |
| 8 | several | `if (!await G(...))` without parentheses, a double-quoted site literal (prettier's default), and `ODDS_BASE + \`...\`` | per the reviewer. Also make the log-only self-test assert its site count equals the scan's guarded count, so a site that drops out fails instead of reading `8 of 8` |

## TASK 0 — probe (Rule 100)

For each row, reproduce the false red at HEAD in a fresh committed
`git archive` copy, through the real deploy-path odds steps, before writing any
fix. A row that does not reproduce is closed with its output, not fixed.

## Done condition (Rule 89 artifacts)

1. Each reproduced row's equivalent rewrite is added to `SITES` in
   `scripts/mutate-deploy-odds-wrappers.mjs` as must-stay-green.
2. The harness log is committed with every equivalent green and every
   existing mutant still CAUGHT.
3. For each fix, one mutation reverting it turns its own new fixture red
   (Rule 90).
4. One green deploy.yml run on the final commit, with its run id recorded.

## FORBIDDEN

- No change to `src/` behaviour.
- A fix may not loosen what a mutant needs to be caught. Every currently CAUGHT
  case must stay CAUGHT.
