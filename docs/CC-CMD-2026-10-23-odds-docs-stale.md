# Claude Code Command — the odds guard's documents describe a guard that no longer exists

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** C (documentation; the next reader is misled)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the Task 3 premise test of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`
(workflow `wf_c984c219-a1f`, 2026-10-23), Rule 87.4.

---

**Narrowed 2026-10-23 (BUILD-ON-A).** A content audit against every existing
CC-CMD (workflow `wf_dd67792d-4ca`) dropped the 09-16 CC-CMD's "five callers"
and "three implementations" lines (already corrected there by appending, on
purpose: "Both stand above as written on 09-16") and answered its "Open and
unowned" list in the same Corrections paragraph. It added three copies this
list missed. **Do not land the `src/` commit 2026-11-08..11-23**:
`src/budget-helpers.js` holds `chargeOdds` and `reconcileOddsCredit`, and the
wrapper comments sit on `consumeOddsCredit` (the CFL experiment's VOID list).

## What is stale (each checked at HEAD `8aeeac6`; re-probe at dispatch)

- `docs/IMPACT-2026-09-16-odds-ceilings.md`: "three monthly implementations"
  that must move together. There is one guard, `chargeOdds` in
  `src/budget-helpers.js`, in D1; the three wrappers each
  `return chargeOdds(env, units, site)`.
- `src/budget-helpers.js` header: "ceiling 18000"; "Three consumers
  participate", naming `snapshotCronOdds` and `_captureClosingOdds
  (in-memory cap replaced)` (`ODDS_SITES` lists nine); "Concurrency:
  read-then-write, not atomic" (the charge is one D1 batch); and the orphaned
  docblock after it ("The monthly counter still acts as the hard ceiling"). A
  comment calls `ensureOddsBudgetTables` "STAGED … no caller today"; it has
  four call sites in four functions (`chargeOdds`, `peekDailyOdds`,
  `reconcileOddsCredit`, `_reconcileOddsCredit`). The same STAGED claim is in
  `docs/CC-CMD-2026-09-18-atomic-odds-counter.md`, where
  `scripts/staged-verifier-check.mjs` scans it. `export const
  ODDS_BUDGET_TABLES` has no importer and omits `odds_budget_month` and
  `odds_reconcile_state`.
- The wrappers' header comments say "KV-backed, monthly" and "Mirrors …
  same KV key" (`src/ambient-do.js`, the wrapper header and the inline
  comment in `_fetchLiveOdds`), and `src/index.js` above `consumeOddsCredit`
  says "KV-" / "backed monthly counter" across a line break, which a grep for
  "KV-backed" misses. Describe the degrade condition as it is at HEAD; item 2
  of `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` owns the update
  when it changes it.
- **Added 2026-10-24, stale once the shared join lands**
  (`docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`):
  comments that describe the join as `byPair.get(...)` (`src/index.js` about
  :15884 and :16082, `scripts/identity_ambiguity_conditions.py` ("to byPair.get before any payload is consulted"),
  `scripts/check-team-identity-collisions.mjs` (its header, "`byPair.get(resolveTeamKey(home) + '|' + resolveTeamKey(away))`")). The one at :16082 also
  explains what the identity-ambiguity watch's same-slate collision count
  measures: rows indistinguishable by resolved keys. After the change the join
  can also merge rows whose keys differ, by name tokens, which a count that
  reads only the archive cannot see. Correct the comment to say so; whether the
  watch should measure it with a payload is a question for its owner, not a
  comment fix.
- The record of the 2026-10-18 ruling calls the daily ceiling monthly:
  `docs/CC-CMD-2026-09-19-daily-vs-vendor.md` ("against a 3,800/month
  ceiling") and its copy in `HANDOFF.md`.

## TASK 1

Append a dated correction under each stale passage in a document, citing the
commit that changed the truth; do not rewrite or delete the original
(`docs/CC-CMD-2026-08-14-stale-records-correction.md`). This matters most for
the ruling record: editing text inside an owner-ruled section can read as
amending the ruling. Source comments are rewritten. The dead export goes only
after `grep -rn ODDS_BUDGET_TABLES src scripts .github` confirms no reader.
One commit for the docs, one for the source comments and export. Comments
only: no behaviour change (`git diff` shows no code line besides the removed
export).

**Gate hazards** (until rows 3 and 7 of
`docs/CC-CMD-2026-10-19-odds-gate-false-reds.md` land): a rewritten comment
must not quote a guard call, a declaration, a charge or a vendor URL, and
must not contain the text `async function ensureOddsBudgetTables`, which
`scripts/check-odds-budget-schema.mjs` finds with a raw `indexOf`. "The
repo's gates green" means the full `deploy.yml` set (a prose
`extractOddsForGame(og)` once turned the deploy red,
`docs/CC-CMD-2026-08-25-misjoined-opening-odds.md`). Clone with full history
before citing the commits that changed the truth.

## Done condition (Rule 90 artifacts)

A `git diff --stat` of exactly these files; the repo's gates green; the
grep for the dead export empty.
