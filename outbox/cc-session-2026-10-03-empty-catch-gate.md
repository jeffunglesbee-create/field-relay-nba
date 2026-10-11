# CC session — the empty-catch gate

**Date:** 2026-10-11
**Repo:** field-relay-nba, branch `main` (direct commits, no PR)
**CC-CMD:** `docs/CC-CMD-2026-10-03-empty-catch-gate.md` — four tasks, five
done conditions, no stop condition hit.

## Outcome

A gate exists, it is a **ratchet rather than a zero**, and the 112 bare catches
it baselines were **not fixed** — the document's own Task 3 puts that out of
scope and the reason is on the record: driving them to zero in one pass is 112
judgement calls made at speed, which is how `.catch(() => {})` reached
`_scheduleAlarm` in `ambient-do.js` under a comment reading *"Always reschedule
— never let the alarm die silently."*

```
  bare                    112
      block            75
      promise          37
  suppressed-with-reason  69
      comment          65
      catch-ok         4
  clean (catch sites)     927
  UNPARSED (files)        0
  empty total             181
```

## Task 0.1 — the real totals, and how they relate to the document's

The document reports 158 (102 in `src/`, ~57 in `scripts/`) with 61 bare. At
HEAD: **181 empty across 396 files, 112 bare**. Both numbers moved because the
tree moved in eight days, and the difference is accounted for rather than waved
at: a glob sweep of `src/*.js scripts/*.mjs` with the auditor returns 177, and
the remaining 4 are the two scripts this session added before measuring
(`mutate-empty-catches.mjs` 3, `live-route-probe.mjs` 1).

**Seven of the document's nine per-file `src/` figures match exactly** —
`bracket-do` 9, `context-assembler` 9, `ambient-do` 6, `browser-do` 4,
`analytics-engine` 2, `nhl-series-r2` 2, `user-do` 2. The two that moved are
`index.js` 20 → 22 and `game-do.js` 7 → 4.

**`budget-helpers.js` is the control and it holds: 0 bare, 6 reasoned.** Every
empty catch in that file carries its reasoning, which is what makes it the file
the others should look like, and it is what proves a commented catch passes.

## Task 0.3 — the dependency decision, which changed once it was measured

`scripts/audit-empty-catches.py` needs `pip install tree-sitter
tree-sitter-javascript`. The first answer was to keep it out of CI: a pip step
is a network dependency on every gate run and guards.yml installs nothing today
beyond `actions/setup-node`.

**That answer was wrong, and the control is what proved it.** Run as an
adjudicator against the dependency-free scanner this session wrote, the AST
found two defects in it that no amount of reading would have:

| defect | what it cost |
|---|---|
| a regex literal holding quotes — `src/browser-do.js:122` reads `selector.match(/:text\(['"](.+)['"]\)/)?.[1];` | the scanner read 4 catch sites in that file where the AST read 13; everything after line 122 was invisible |
| a nested template literal — `` `${x ? `<b>${y}</b>` : ''}` `` | four whole files lost, `src/context-assembler.js` (11 empty catches) among them |

Neither was a count off by a little. Each was a silent zero over most of a file,
and a silent zero is the worst answer a gate like this can give.

So the install is in both workflows and `--control` runs in the gate. **An
absent tree-sitter FAILS rather than skipping** — a control that did not run is
not a pass.

The engine stays in JS and dependency-free, so `--self-test` and the baseline
check work on any machine with node and nothing else. The AST adjudicates; it
does not drive.

### And the auditor learned to take more than one file

`--control` originally spawned `python3` once per file — 396 processes, 2m15s,
far too slow to sit in a gate. The auditor now accepts a file list and prints
one `PERFILE <path> <n>` line each, keeping its single-file output byte-identical
because this document's own measurements depend on it.

Together with one performance fix in the scanner — `prevSignificant()` ran a
regex over the entire accumulated mask on **every slash**, and `src/index.js`
holds thousands — the full scan plus AST adjudication of 396 files went
**2m15s → 1.9s**. The counts are identical before and after, which is what makes
it a performance fix rather than a change.

**396 of 396 files compared. 0 disagreed.**

## Task 1 — the gate

`scripts/check-empty-catches.mjs <roots> --baseline=N [--require=path:line]
[--control] [--json] [--self-test]`

Conventions are the client's `check-absence-collapse.mjs`, deliberately: three
counts and never a verdict, a suppression that carries a reason so exemptions
are greppable, `MALFORMED SUPPRESSION` for a bare pragma, `--self-test`,
`--require`, `--json`, and the file excluded from its own scan because it quotes
every pattern it matches.

Two things are this file's own:

- **`--baseline=N` fails only when bare RISES.** A fall prints a note to lower
  the baseline rather than passing silently.
- **UNPARSED is a reported state, not a count of zero.** A single- or
  double-quoted string cannot span a newline in valid JavaScript, so reaching
  one proves the scan is lost; the file is then named with the line it was lost
  at. Four files were in this state before the nested-template fix.

### The suppression mechanism had to be reachable

Written body-only at first. The first four reasons added — to this session's own
scripts — went above the `try`, and the bare count changed by **nothing: 116
before, 116 after**. A bare `catch (_) {}` has nowhere inside it to write a
reason, so the pragma is now honoured on the catch's own header and closing
lines too, which is the trailing form the client already uses. Bare then fell
116 → **112** and `catch-ok` reads 4.

A plain comment still counts only INSIDE the body — a comment on the
surrounding line could be about anything — while the explicit `catch-ok:` token
is precise enough to honour wherever it sits in those lines.

### Wired into BOTH workflows, because one of them cannot see src/

`guards.yml` carries `paths-ignore: src/**`. A bare catch added to
`src/index.js` is precisely a src-only push, so guards.yml would not run and the
gate would be blind in the one case it exists for. It is duplicated into
`deploy.yml`, the same way the four other src-reading guards already are — that
file's own header records what happened the last time a guard set's trigger did
not cover its inputs.

**`--require=src/ambient-do.js:306` is the check's own acceptance test.** That
line reads `try { writer.close(); } catch (_) {}` — an SSE writer closed on an
abort event, swallowed bare. If a later session gives it a reason, the require
fails and the gate goes red for a good change; update the require to another
bare site in the same commit as the fix.

## Task 2 — the mutation counterpart

```
baseline: 396 files, bare 112, empty total 181, UNPARSED 0

  CAUGHT  M1 a bare block catch
  CAUGHT  M2 a bare promise catch
  CAUGHT  M3 catch-ok with no reason is MALFORMED, not a suppression
  PASSES  M4 catch-ok WITH a reason suppresses
  PASSES  M5 a plain comment is a stated reason
  PASSES  M6 a catch that does something is clean
  CAUGHT  M7 a bare catch AFTER a nested template literal
  CAUGHT  M8 a bare catch AFTER a regex literal holding quotes
  CAUGHT  M9 an unterminated quote is UNPARSED, not zero

restored: bare 112, exit 0

9 caught, 0 wrong, 0 never placed, of 9 mutations
COVERAGE: the gate end to end, through real files in src/. It does NOT
mutate the classifier's own branches — --self-test does that, 35 cases.
```

`M4`, `M5` and `M6` are there because a gate that rejects a properly reasoned
catch is as broken as one that accepts a bare one. `M7` and `M8` are the two
regressions above, kept as mutations so neither can come back. `M9` asserts that
an unparseable file reports UNPARSED rather than a count.

**The harness asserts its own placement.** Every mutation checks that the gate's
`scanned N files` ROSE before reading a verdict; if the mutant was never read it
prints `NOT-PLACED` and no verdict, which is the corollary this repo wrote after
`mutate-hockey-wp` printed `NOT CAUGHT` with nothing mutated.

**An empty result is a failure.** If the clean scan finds zero empty catches
across `src/` and `scripts/`, the harness exits 1 and says the checker is
broken, not the tree clean.

## Task 3 — the 112 were NOT fixed

Out of scope by the document's own Task 3, and recorded here so a later session
can work through it. 50 files carry at least one.

| file | bare | reasoned |
|---|---|---|
| `src/index.js` | **22** | 5 |
| `src/bracket-do.js` | **9** | 3 |
| `src/context-assembler.js` | **9** | 2 |
| `src/ambient-do.js` | **6** | 4 |
| `scripts/bsd-broadcasts-probe.mjs` | **5** | 1 |
| `src/browser-do.js` | **4** | 1 |
| `src/game-do.js` | **4** | 9 |
| `scripts/probe-bundesliga-default-matchday-view.mjs` | **3** | 0 |
| `scripts/probe-bundesliga-matchday-date-text.mjs` | **3** | 0 |
| `scripts/bsd-contract-verify.mjs` | **2** | 0 |
| `scripts/build-provenance-view.mjs` | **2** | 0 |
| `scripts/probe-last-54-route.mjs` | **2** | 0 |
| `src/analytics-engine.js` | **2** | 6 |
| `src/nhl-series-r2.js` | **2** | 0 |
| `src/user-do.js` | **2** | 1 |
| `scripts/bsd-coverage-probe.mjs` | **1** | 0 |
| `scripts/bsd-form-probe.mjs` | **1** | 0 |
| `scripts/bsd-lineups-probe.mjs` | **1** | 0 |
| `scripts/bsd-surface-probe.mjs` | **1** | 0 |
| `scripts/bsd-tennis-date-probe.mjs` | **1** | 0 |
| `scripts/bsd-tennis-draw-probe.mjs` | **1** | 0 |
| `scripts/bsd-tennis-draw-shape-probe.mjs` | **1** | 0 |
| `scripts/check-handoff-claims.mjs` | **1** | 0 |
| `scripts/check-no-foreign-domain.mjs` | **1** | 0 |
| `scripts/check-provenance-stamp-stability.mjs` | **1** | 0 |
| `scripts/check-route-provenance.mjs` | **1** | 0 |
| `scripts/gemini-model-comparison-score.mjs` | **1** | 0 |
| `scripts/jlayer-model-probe.mjs` | **1** | 0 |
| `scripts/jq-judge-live-probe.mjs` | **1** | 0 |
| `scripts/mutate-ceiling-reached.mjs` | **1** | 0 |
| `scripts/mutate-daily-vs-monthly.mjs` | **1** | 0 |
| `scripts/mutate-dead-pairs.mjs` | **1** | 0 |
| `scripts/mutate-monthly-atomic.mjs` | **1** | 0 |
| `scripts/mutate-provenance-stamp-stability.mjs` | **1** | 0 |
| `scripts/nfl-preseason-start-probe.mjs` | **1** | 0 |
| `scripts/nfl-tables-serve-probe.mjs` | **1** | 0 |
| `scripts/nfl-v2-gameid-probe.mjs` | **1** | 0 |
| `scripts/nhl-shiftcharts-probe.mjs` | **1** | 0 |
| `scripts/ownership-limit-check.mjs` | **1** | 0 |
| `scripts/probe-espn-kickoff-route.mjs` | **1** | 0 |
| `scripts/probe-fpl-explain.mjs` | **1** | 0 |
| `scripts/probe-fpl-fixture-stats.mjs` | **1** | 0 |
| `scripts/provenance-runtime-probe.mjs` | **1** | 0 |
| `scripts/run-last-54-resolve.mjs` | **1** | 1 |
| `scripts/run-start-time-resolve.mjs` | **1** | 0 |
| `scripts/tennis-tier-ladders.mjs` | **1** | 0 |
| `scripts/verify-coverage-route.mjs` | **1** | 0 |
| `scripts/verify-tennis-draw.mjs` | **1** | 0 |
| `scripts/wnba-failover-verify.mjs` | **1** | 0 |
| `scripts/wnba-slate-to-kv.mjs` | **1** | 0 |
`src/` holds 60 of the 112; `scripts/` holds 52 across 41 files, almost all
one apiece.

## Done conditions

| | |
|---|---|
| 0.1 real totals and the bare/reasoned split | 181 empty, 112 bare, 69 reasoned, per file above |
| 0.3 dependency decision with reasoning | recorded above — it changed, and why |
| gate wired into a real workflow, baseline declared, three counts | `guards.yml` AND `deploy.yml`, `--baseline=112` |
| mutation demonstrated failing then passing, output verbatim | 9 of 9 above, `restored: bare 112, exit 0` |
| `budget-helpers.js` at zero bare | **0 bare, 6 reasoned** |

Self-tests: **35** on the classifier, the mask and the site finder.
