# Claude Code Command — Gate empty catches in the relay

**Date:** 2026-10-03
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (feature) — CI gate for an auditor that already exists

**Status:** FILED, not started.

## CONTEXT — the relay has the instrument and no gate

`scripts/audit-empty-catches.py` exists (AST, tree-sitter, built 2026-07-13) and
**no workflow references it.** Verified 2026-10-03:
`grep -rln "audit-empty-catches" .github/workflows/` returns nothing.

`jubilant-bassoon` has the complement: `scripts/check-absence-collapse.mjs`,
wired into `deploy-gate.yml`, with a `// absence-ok: <reason>` suppression that
**rejects a bare pragma** — an `absence-ok:` with nothing after it is reported as
`MALFORMED SUPPRESSION`, not accepted.

That asymmetry is the gap. The relay can find these; nothing stops new ones.

## MEASURED 2026-10-03 — run the auditor over every file, use its TOTAL line

`src/` holds **102** genuinely-empty catches: **41 carry a stated reason, 61 are
bare.**

| file | bare |
|---|---|
| `index.js` | 20 |
| `bracket-do.js` | 9 |
| `context-assembler.js` | 9 |
| `game-do.js` | 7 |
| `ambient-do.js` | 6 |
| `browser-do.js` | 4 |
| `analytics-engine.js` | 2 |
| `nhl-series-r2.js` | 2 |
| `user-do.js` | 2 |

`scripts/` holds the remainder (~57, thin, mostly 1–3 per file).

**`budget-helpers.js` has SIX empty catches and ZERO bare** — every one carries
its reasoning (*"Attribution must never fail a fetch"*, *"Deliberately empty. See
BEST EFFORT above"*, *"An unparseable URL must not charge zero"*). It is the
standard the other files should meet, and it already meets it.

### Four different numbers were reported for this one quantity

A chat session on 2026-10-03 produced, in order: **32** (grep), **112** (quoted
from `outbox/cc-session-2026-09-13-ambient-alarm-and-catch-collapse.md`), **37**
(AST, misread), and **158** (AST, correct, `src/` + `scripts/`). The actionable
subset is **61**.

The 37 was wrong because the extraction took the FIRST `N empty` on each page —
the block-statement count — so any file whose findings were all promise-chain
read as zero. `probe-bundesliga-matchday-date-text.mjs` has 3 and was skipped
entirely. **Use the tool's own `TOTAL genuinely empty (both patterns): N` line.**

The 32 was wrong because it was grep. The auditor's own header says why it
exists: *"grep-based manual review repeatedly missed real sites (multi-line catch
bodies where the log call sits on the next line)"*, and that a prior "118" figure
*"only ever covered pattern 1 — it never surveyed pattern 2 at all."*

## TASK 0 — PROBE (read from HEAD, do not trust this document)

1. Re-run the auditor across `src/*.js` and `scripts/*.mjs`. Record the real
   totals and the bare/commented split. The numbers above are a starting point.
2. Read `jubilant-bassoon/scripts/check-absence-collapse.mjs` — specifically the
   `SUPPRESS` regex, the `MALFORMED SUPPRESSION` state, the three-count output,
   and `--self-test` / `--require`. **Follow these conventions; do not invent a
   parallel mechanism.**
3. Confirm `audit-empty-catches.py` needs `pip install tree-sitter
   tree-sitter-javascript`. The relay's existing gate workflows run with no
   `npm ci` — establish whether adding a Python dependency is acceptable in the
   host workflow or whether the auditor should be ported to the JS checker's
   shape instead. **Report the choice and why; do not assume.**

## TASK 1 — Gate on NO NEW BARE CATCHES, not on zero

Declare the measured bare count as a baseline. Fail when it RISES.

**Do not set the gate to zero.** Driving 61 to zero in one pass means 61
judgement calls made at speed, which is exactly how `.catch(() => {})` reached
`_scheduleAlarm` in `ambient-do.js` against a comment reading *"Always reschedule
— never let the alarm die silently."*

Suppression is `// catch-ok: <reason>` (or the existing `absence-ok` spelling if
Task 0.2 shows one checker can cover both). **A bare pragma must be rejected**,
exactly as the client's does.

Report THREE counts, never a verdict: bare / suppressed-with-reason / clean.

## TASK 2 — Mutation counterpart

`mutate-*` is this repo's established convention (`mutate-collision-reach.mjs`,
`mutate-silently-dead-crons.mjs`, `mutate-ceiling-reached.mjs`). Add one: insert a
bare empty catch, confirm the gate fails and names the file and line; remove it,
confirm green. **A gate that has only ever passed has proven nothing.**

An empty result is a FAILURE, not a pass — the convention recorded in
`outbox/cc-session-2026-09-16-odds-name-matcher.md`. If the auditor returns zero
findings across the whole tree, that is the auditor broken, not a clean tree.

## TASK 3 — Do NOT fix the 61 in this session

Out of scope. The gate stops the bleeding; the backlog is separate work and each
one is a judgement about whether the swallow is correct.

Record the baseline list in the outbox so a later session can work through it.

## DONE CONDITION

- Task 0.1 real totals and bare/commented split recorded.
- Task 0.3 decision recorded with reasoning.
- Gate wired into a real workflow, baseline declared, three counts reported.
- Mutation counterpart demonstrated failing then passing, output pasted verbatim.
- `budget-helpers.js` confirmed at zero bare — it is the control for "commented
  catches pass".

## TASK 4 — Outbox manifest (last task)

`outbox/cc-session-2026-10-03-empty-catch-gate.md` with the Task 0 output, the
Python-dependency decision, the baseline list by file, the mutation output, and
an explicit statement that the 61 were not fixed.
