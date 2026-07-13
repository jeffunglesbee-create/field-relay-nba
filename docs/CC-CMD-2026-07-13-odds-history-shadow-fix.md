# Claude Code Command — Resolve shadowed /odds/history/ route (real behavioral differences, not a simple merge)

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** two /odds/history/ route blocks with genuinely different behavior, not just duplicate logic. Requires real investigation before deciding which behavior to keep.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/odds-history-shadow-fix-2026-07-13.md.

## CONTEXT — found via a systematic duplicate-prefix check after the MLB-Stats shadowing fix, real, confirmed differences

Two `/odds/history/` blocks exist:

- **Block 1 (~L8326, executes first):** `if (pathname.startsWith('/odds/history/') && env.ARCHIVE_DB)`. `SELECT *`, `ORDER BY snapshot_time DESC`. On any DB error: silently returns `{ok:true, odds:[], _note:'odds_history table may not exist yet'}` (graceful, but masks real errors as empty results).
- **Block 2 (~L10881, dead — shadowed by Block 1 whenever `env.ARCHIVE_DB` is truthy, which is presumably always in production):** unconditional path match, explicit `!env.ARCHIVE_DB` check returning a real 503. Explicit column list (not `SELECT *`), `ORDER BY snapshot_time ASC, created_at ASC`. On DB error: real `{ok:false, error:e.message}` with a 500. Its own comment ("June 20 2026... Match MUST come before the /odds/* passthrough below") shows the author knew about ordering sensitivity relative to the `/odds/*` passthrough further down, but was unaware Block 1 already existed earlier in the file and already shadows it.

**This is not the MLB-Stats situation.** That fix was "transplant working logic into the reachable block, remove the redundant one" because both blocks did the same thing. Here the blocks disagree on sort order, column selection, and error philosophy — picking wrong silently changes what every caller of this endpoint receives.

## TASK 0 — Probe (the real question: which behavior do callers actually need)

1. Find every real caller of `/odds/history/{game_id}` — grep `jubilant-bassoon`'s `index.html` and any other relay-internal caller. For each, confirm: does it expect ascending (chronological, oldest-first) or descending (most-recent-first) order? Does it consume the full row (needing Block 2's explicit columns) or just a subset (making `SELECT *` harmless)? Does it handle `ok:false`/500 gracefully, or would Block 1's silent `ok:true`/empty-array-on-error be masking a real bug from any consumer that assumes an error always means `ok:false`?
2. Check `odds_history` table's real schema (via D1) — confirm both queries are even querying real, current columns, and whether `SELECT *` vs the explicit list would actually differ in practice today.
3. Determine which block's behavior is more likely correct/intended given (1) and (2) — real reasoning, not a coin flip. If genuinely ambiguous after real investigation, say so explicitly rather than force a confident-sounding pick.

## TASK 1 — Resolve

Based on TASK 0's real findings: keep the one block whose behavior (sort order, error handling, column selection) is actually correct for real callers, remove the other. If both blocks' behaviors are used by different real callers in ways that can't be reconciled into one block, say so explicitly and stop rather than silently picking one and breaking the other caller — this would need a second CC-CMD to resolve properly (e.g. a query param for sort direction) rather than being forced through here.

## TASK 2 — Verify

- Real live test: request `/odds/history/{a real game_id with real odds_history rows}`, confirm the response matches the TASK 1 decision (real sort order, real column presence, real error behavior on a forced bad game_id or similar).
- Confirm zero regression to the `/odds/*` passthrough route that follows (mentioned in Block 2's own comment as order-sensitive).
- `node --check` clean, `git diff` shows a scoped, explained change.

## DONE CONDITION

One `/odds/history/` block, its behavior chosen based on real caller investigation (not assumed), real live verification. If genuinely irreconcilable, honestly reported as needing a follow-up rather than forced.

**Confidence scoring:**
- TASK 0 real caller investigation, real schema check, real reasoning for the chosen behavior (40 pts)
- TASK 1 correct resolution matching TASK 0's real findings, or an honest stop if genuinely irreconcilable (30 pts)
- TASK 2 real live verification, zero regression to the adjacent passthrough (30 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
