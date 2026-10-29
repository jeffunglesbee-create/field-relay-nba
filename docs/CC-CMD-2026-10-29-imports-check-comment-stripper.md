# Claude Code Command — the import check's comment stripper can hide a missing import

**Date:** 2026-10-29
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a check passes when it should fail, and fails when it should pass)
**Confidence gate:** >= 95 before any commit
**Status:** DONE 2026-10-29 (see Results)
**Filed by:** the gates run of `1d55722` (Route A of
`docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md`), Rule 87.4: a finding that would otherwise have been a
carry-forward. Searched first (BUILD-ON-A): `docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md` asks for a
string-aware comment stripper for `check-odds-calls-guarded.mjs`, a different script; nothing covers
`scripts/check-imports-resolve.mjs`.

---

## What was found

`scripts/check-imports-resolve.mjs` strips comments and strings before it looks for calls and imports
(`:47-50`). It strips `/* … */` FIRST, over the raw text, then whole-line `//` comments, then strings. A `/*` that sits
in a `//` comment or in a string therefore opens a block comment that runs to the next `*/` anywhere later in the file,
and everything between is deleted before the check reads it.

Measured 2026-10-29:

| input | expected | got |
|---|---|---|
| `1d55722`'s parent `171afc6` | pass | pass, `0 unresolved` |
| the same tree plus one new comment containing the text `/admin/*` | pass | **FAIL**, four calls "with no import" (the import block was swallowed) |
| fixture: `// the /admin/* routes` then `foo()` with no import, then a real `/* … */` further down | FAIL (foo is not imported) | **pass**, exit 0 |
| fixture: `const r = '/admin/*';` then `foo()` with no import, then a real `/* … */` | FAIL | **pass**, exit 0 |

The first two rows are the false positive that stopped a push. The last two are the dangerous direction: a call to a
function nobody imported, hidden from the check.

**How much the check does not read today** (measured the same day against `scripts/lib/blank-comments.mjs`, the shared
string- and regex-aware stripper that its header says was checked against acorn's tokenizer: 0 lines differ): the
current first pass swallows **119,320 non-blank characters of real code in four modules** — `src/index.js` 106,014 in 18
spans, `analytics-engine.js` 9,543, `ambient-do.js` 3,396, `budget-helpers.js` 367. Every one starts at a route-comment or
header-string such as `// Route: /espn-gambit/* → …` or `'Accept': '…, */*'`. The widest
span is 80,693 characters (`index.js` line 14263).

**What reading all of it finds** (same run, shared stripper, import recognition unchanged): 3 unresolved, all in
`src/index.js`: `computeOddsStory()`, `checkAllSources()`, `detectEliminationTraps()`. Each is a valid
`const { name } = await import('./module.js')` (lines 12124, 11989, 12244) that the check does not recognise as an import
and that the swallowed spans had been hiding. With that recognised, **0 unresolved on all 50 modules**: no import is
missing today, so this is a blind check, not a latent outage. The check exists because of exactly that (`dde1dc4`, 2026-09-05: three
Durable Object constructors called an unimported `withKvProvenance`, and `/live/ambient` returned 500/1101 for a day).

## Probe block (run first, from current HEAD)

```sh
git log --oneline -3 -- scripts/check-imports-resolve.mjs
sed -n 40,70p scripts/check-imports-resolve.mjs
grep -n "imports-resolve" .github/workflows/deploy.yml .github/workflows/guards.yml
node scripts/check-imports-resolve.mjs | tail -1        # expect: 0 unresolved
```

## TASK 1 — read code through the shared stripper (BUILD-ON-A: no second stripper)

`scripts/lib/blank-comments.mjs` (`blankCommentsAndStrings`) already defines "code" for the two deploy-path odds checks:
it walks the text once, knows strings, templates, `//`, `/* */` and regex literals, and keeps line numbers. Import it in
`scripts/check-imports-resolve.mjs` and replace the three `.replace` calls with it. Its documented property is that
template text outside `${…}` is kept (billed URLs live there). For this check that means a name followed by `(` in
template prose can read as a call: a false positive, never a hidden call. The self-test states it; it does not hide it.

## TASK 1b — a dynamic import binds its names

`const { name } = await import('./x.js')` (and `import(...)` without `await`) is an import. Record the BOUND name: for
`{ a, b: c }` that is `a` and `c`, and a default (`= v`) is stripped. Without this TASK 1 fails the three valid lines
listed above. File-level granularity is unchanged (a name bound in one function counts for the whole file, as the static
imports do); the self-test states it.

## TASK 2 — the check gets a self-test, and the self-test gets mutants (Rule 90)

- `scripts/check-imports-resolve-selftest.mjs`: fixtures written to a temp dir, run with `SRC_DIR`, each asserting the
  exit code AND, for a failure, that the output names the call. Every case below prints its own line. The script under
  test comes from `CHECK_SCRIPT` (default the real one) so the mutants can aim it at a copy.
  1. a plain missing import (FAIL)
  2. the import present (pass)
  3. `//` comment with a slash-star, a missing call, a real block comment below (FAIL; the dangerous direction)
  4. the same with the slash-star in a string (FAIL)
  5. the same comment with the import present (pass; the false positive that stopped `1d55722`)
  6. the name in a `//` comment, 7. in a block comment, 8. in a string, 9. in a trailing `//` comment (all pass)
  10. a regex literal holding a quote, then a missing call (FAIL)
  11. a dynamic-import destructure binding the name (pass), 12. a renamed one `{ foo: bar }` then `foo()` (FAIL)
  13. `barfoo()` where `foo` is exported elsewhere (pass), 14. a module calling its own export (pass)
- `scripts/mutate-imports-resolve.mjs`: copies the check next to itself, applies ONE mutation per run, asserts each
  anchor occurs exactly once, and counts a mutant CAUGHT only when an assertion failed (a crash is a harness error).
  Mutants: the old three-`replace` chain restored; no stripping; dynamic-import recognition removed; the dynamic import
  recording the property instead of the bound name; static-import recognition removed; the `\b` dropped from the call
  match; the self-export skip removed; the exit code forced to 0.
- Both run in `deploy.yml` straight after the existing step "Every cross-module call resolves to an import".

## Done condition (Rule 90 artifacts)

1. The self-test prints `N of N passed` with its case list, and run against the OLD three-`replace` chain prints the
   failing cases by name (3, 4, 5, 10 and 11 at least): red before, green after.
2. The mutation harness prints `M of M caught`, `0 not applied`, `0 harness error(s)`.
3. `node scripts/check-imports-resolve.mjs` on the repo prints `50 module(s)` and `0 unresolved`, and the run that
   produced the 119,320 and the 3 above is repeated with its output committed.
4. `gates.py` on the committed tree: only the two environment-only failures; Deploy RELAY Worker and Repo guards green.

## FORBIDDEN

- No new stripper. If `blankCommentsAndStrings` is wrong, fix it in `scripts/lib/blank-comments.mjs`, where the two
  odds checks that share it also see the fix, and say so.
- No change to what the check treats as an export or a local definition (the two `exportsByName` loops and the `localDefs` loops), and static imports keep
  recording the imported name (`import { a as b }` records `a`: a known gap, stated, not widened).

## Results (2026-10-29)

1. **Red before, green after.** `scripts/check-imports-resolve-selftest.mjs` has 16 cases. Aimed at the old check
   (`CHECK_SCRIPT=<the check at 292233f>`) it prints `9 of 16 passed.` and fails 3, 4, 5, 9, 10, 11 and 15 by name; on
   the fixed check, `16 of 16 passed.` Cases 3
   and 4 are the dangerous direction (a missing import hidden); 5 is the false failure that stopped `1d55722`; 10 is a
   regex literal holding a quote; 11 is the dynamic import; 15 is a call inside `${...}`, which the old string pass
   erased with the rest of the template.
2. **Mutants.** `scripts/mutate-imports-resolve.mjs`: `9 of 9 caught`, 0 survived, 0 not applied, 0 harness errors. A
   tenth mutant (removing the `owner === f` skip) survived and was dropped with a comment: the skip is redundant,
   because a module's own export is always in its `localDefs`; the harness says so rather than counting it.
3. **The measurement, committed:** `outbox/imports-check-blindness-measure-20261029.md`
   (`scripts/measure-imports-check-blindness.mjs`): 119,320 code characters unread in four modules; 0 unresolved
   across all 50 modules once read and once dynamic imports bind names.
4. **Wired:** `deploy.yml`, after "Every cross-module call resolves to an import" (the check itself is not in
   `guards.yml`, so the self-test is not either).
5. **Gates:** see the session doc `outbox/cc-session-2026-10-29-route-a-and-import-check.md`.

**Not changed, stated:** `scripts/lib/blank-comments.mjs` (shared with the two odds checks); static `import { a as b }`
still records `a`; an import is file-level; template prose outside `${...}` can read as a call.
