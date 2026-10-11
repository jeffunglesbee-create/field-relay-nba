# CC-CMD-2026-08-25-port-citation-check

**Filed:** 2026-08-25.
**Target:** jubilant-bassoon, then field-playground.
**Status:** DONE 2026-10-11, with one done condition met in one repo only and
the reason stated. Session doc:
`outbox/cc-session-2026-10-11-port-citation-check.md`.

**THE "COPY VERBATIM" INSTRUCTION WAS WRONG, AND THIS DOCUMENT'S OWN *Why*
SECTION SAYS WHY.** It warns against a check "written for one repo, reported as
if it measured the problem". The relay's pattern matches
`(src|scripts|workers|.github)/…`; jubilant-bassoon is a root-level single-file
PWA. Counted there before writing anything: `index.html` **2738**, `smoke.js`
809, `sw.js` 481, against `src/legacy/field.js` 469 and
`scripts/sync-source.mjs` 68. A verbatim copy reaches the second group and none
of the first — a confident green over the repo's most cited files, which is
this document's own named failure, reproduced by the port of its fix.

So the roots stayed and an allow-list of seven root files was added beside
them. **Of the 26 bare citations found, 22 are root files.**

field-playground needed the opposite call. It IS rooted, so the roots carried
over — but `jsx` (236) and `css` (136) are 372 citations the relay's extension
list cannot see, and `ROOT_FILES` is deliberately **empty** there: `index.html`
is cited eight times at lines 6671–27168 and that repo's `index.html` is **16
lines**, so those are jubilant-bassoon's file cited across repos and would have
been checked against the wrong one.

**MEASURED COUNTS (ask 2 and 3 — the budget is set from these, not from 9):**

| | jubilant-bassoon | field-playground |
|---|---:|---:|
| documents | 955 | 140 |
| anchored | 3332 | 345 |
| **bare / budget** | **26** | **0** |
| no file | 232 | 36 |
| path only | 2447 | 287 |

**Ask 4 — wired into a workflow that runs on every push**, and the document's
claim about which was verified rather than taken: jubilant-bassoon
`smoke-and-verify.yml` (every push to main), field-playground
`build-check.yml` (every push, no paths filter).

**Neither green was trusted on its own.** `bare 0` reads the same whether there
is nothing to find or the matcher found nothing, so both ratchets were made to
fail on purpose and restored.

**ONE GREEN RUN PER REPO IS MET IN ONE REPO ONLY.** jubilant-bassoon run
`38138554268` — workflow success. field-playground run `38138844720` — the
citation step **passes**, the workflow does not: `Build Check` has failed on
every run in its visible history at `Probe the latency chart`, six consecutive
days before this change. Filed, not fixed:
`field-playground docs/CC-CMD-2026-10-11-build-check-latency-probe-red.md`.

## Why

`scripts/check-doc-citations.mjs` shipped here and in field-laboratory on
2026-08-25 after five of six citations published that morning turned out stale
by the afternoon. jubilant-bassoon carries the largest documentation corpus of
the four repos and has no such check.

This is the same shape as the secret scanner six hours earlier: written for one
repo, reported as if it measured the problem, and a cross-repo scan found the
rest. **Do not report a citation figure for "the project" from one tree.**

## The ask

1. **Copy `scripts/check-doc-citations.mjs`** verbatim. It carries eight
   self-test cases including the `lineOf` uniqueness fix — a repair hint must
   not be printed for an ambiguous anchor.
2. **Run it and paste the counts.** Do not assume they resemble this repo's
   (`anchored 1550 / bare 9 / no file 51`). Measure.
3. **Set `docs/citation-budget.txt` to the MEASURED bare count**, not to 9.
4. **Wire it into a workflow that runs on every push** — in jubilant-bassoon
   that is `smoke-and-verify.yml`, not the paths-filtered `deploy-gate.yml`.
5. **Repeat for field-playground.**

## Expect a high `no file` count, and do not treat it as failure

jubilant-bassoon cites relay paths constantly and vice versa. The check reports
missing files and never fails on them, for exactly that reason.

## Done condition

The printed count block from each repo, verbatim, in the outbox manifest — plus
one green CI run per repo on a real push. A green run alone is not the done
condition; the counts are, because the budget is only meaningful if it was
measured rather than copied.
