# Claude Code Command — the import check's comment stripper can hide a missing import

**Date:** 2026-10-29
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a check passes when it should fail, and fails when it should pass)
**Confidence gate:** >= 95 before any commit
**Status:** FILED 2026-10-29, built in the same session (see Results)
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
function nobody imported, hidden from the check. The check exists because of exactly that (`dde1dc4`, 2026-09-05: three
Durable Object constructors called an unimported `withKvProvenance`, and `/live/ambient` returned 500/1101 for a day).

## Probe block (run first, from current HEAD)

```sh
git log --oneline -3 -- scripts/check-imports-resolve.mjs
sed -n 40,70p scripts/check-imports-resolve.mjs
grep -n "imports-resolve" .github/workflows/deploy.yml .github/workflows/guards.yml
node scripts/check-imports-resolve.mjs | tail -1        # expect: 0 unresolved
```

## TASK 1 — one pass, in source order

Replace the three sequential `replace` calls with ONE regex whose alternatives are tried left to right, so whichever
construct starts first wins: block comment, `//` to end of line (not only at the start of a line), or a string. A `/*`
inside a line comment or a string is then consumed by that comment or string. The result must stay identical for every
module in `src/` today (compare the sets of `imported`, `localDefs` and the call matches before and after, per file;
all 50 modules).

## TASK 2 — the check gets a self-test, and the self-test gets mutants (Rule 90)

- `scripts/check-imports-resolve-selftest.mjs`: fixtures written to a temp dir, run with `SRC_DIR`, each asserting the
  exit code AND, for a failure, that the message names the call. Cases: the four rows above; a plain missing import
  (FAIL); a name in a `//` comment, in a block comment and in a string (pass); a trailing `//` comment naming a call
  (pass); an import present with the comments above (pass).
- `scripts/mutate-imports-resolve.mjs`: copies the check, applies one mutation per run (the old sequential order; the
  string strip removed; the line-comment strip removed; the block-comment strip removed), asserts each anchor occurs
  exactly once, and counts a mutant CAUGHT only when an assertion failed. Exits non-zero otherwise.
- Both run in `deploy.yml` straight after the existing step "Every cross-module call resolves to an import".

## Done condition (Rule 90 artifacts)

1. The two failing fixtures above exit 1 at the parent and 0 → 1 as listed after the fix; the self-test prints
   `N of N passed` with N and the case list in its own output.
2. The mutation harness prints `M of M caught`, `0 not applied`.
3. `node scripts/check-imports-resolve.mjs` on the repo still prints `0 unresolved` and `50 module(s)`, and the
   per-file comparison of TASK 1 shows no difference.
4. `gates.py` on the committed tree: only the two environment-only failures; Deploy RELAY Worker and Repo guards green.

## FORBIDDEN

- No change to what the check treats as an export, an import or a local definition (`:35-36`, `:52-62`).
- Not a tokenizer: regex literals containing quotes are a known gap of the old stripper and of this one; say so in
  the self-test's header rather than widening the change.
