# Claude Code Command — Permanent duplicate-route-prefix detection

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** a new script + CI/smoke integration that flags duplicate/overlapping pathname.startsWith() prefixes for human review. Warns, does not hard-fail (some duplicates are legitimate, e.g. mutually-exclusive env-flag branches).

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/duplicate-prefix-detector-2026-07-13.md.

## CONTEXT — real, found-by-accident bugs, not hypothetical

Two real route-shadowing bugs were found tonight in this exact file, both by accident (side effects of unrelated work — the empty-catch sweep, then a manual grep prompted by a direct question about durability), not by any systematic check: `/mlb-stats/{file}` (Block 1 unconditionally shadowed Block 2's real R2-first logic — fixed in a separate CC-CMD tonight) and `/odds/history/` (Block 1's `env.ARCHIVE_DB` gate almost certainly always shadows Block 2 in production — being resolved in a separate, real-investigation CC-CMD tonight, since the two blocks have genuinely different behavior, not just duplicate logic).

A quick manual scan of `pathname.startsWith(...)` prefixes found these 2 real issues plus 2 false positives (comment mentions, not real duplicate blocks) and 1 correct pattern (mutually-exclusive `env.X`/`!env.X` branches) out of only ~20 prefixes checked casually. This file is 14,000+ lines with many more route prefixes than were checked — there could be more undiscovered instances. This CC-CMD makes the check permanent and automatic instead of relying on it being stumbled into again.

## TASK 0 — Probe

Read this file's real, current route-dispatch structure (the main `fetch` handler, or wherever `pathname.startsWith(...)`/`pathname === ...` checks live) to understand the real shape before writing a parser against it — don't assume from this doc's description.

## TASK 1 — Build the detector

A script (e.g. `scripts/check-route-shadowing.js` or `.mjs`, matching this repo's existing script conventions if any exist — check first) that:
- Parses `src/index.js` (real AST parsing preferred if tooling supports it in this environment, regex-based extraction acceptable if not — but if regex, be careful about false positives from comments, matching tonight's own two false-positive findings)
- Extracts every `pathname.startsWith('...')` and `pathname === '...'` check with its line number and any additional guard condition on the same `if` (e.g. `&& env.X`, `&& !env.X`)
- Groups checks where one prefix is a prefix of another (or identical), in file order
- For each group of 2+: flag it UNLESS the guard conditions are provably mutually exclusive (e.g. `env.X` paired with `!env.X` on the same variable) — those are legitimate and should not be flagged
- Output: a clear, human-readable report of genuinely suspicious groups (earlier block's condition, later block's condition, both line numbers) — this is a warn-and-report tool, not an auto-fixer

## TASK 2 — Wire it in

Add this as a check in whatever this repo's real CI/deploy-gate pipeline is (probe fresh — don't assume the exact mechanism), running on every push to `src/index.js`. It should warn/report, not hard-block the pipeline — false positives are possible for genuinely intentional patterns this session's judgment can't fully anticipate, and this needs human review, not automatic rejection. Make the warning visible (a job annotation, a PR-comment-style output, or whatever this repo's existing patterns support) rather than something that silently passes in a log no one reads.

## TASK 3 — Run it for real right now

Run the new detector against the current `src/index.js` (post tonight's two fixes). Confirm it correctly does NOT flag `/user/` (the legitimate mutually-exclusive case), confirms both `/mlb-stats` and `/odds/history/` shadowing are resolved (zero flags for those prefixes now), and report whether it finds any OTHER genuine candidates beyond the ~20 prefixes checked casually tonight — this is the first real, full-file run, not just a re-check of the 2 already-known issues.

## DONE CONDITION

A real, working, wired-in detector that correctly distinguishes genuine shadowing from legitimate mutually-exclusive branching, confirmed via a real run against the current file (including whether new candidates beyond tonight's manual 20-prefix spot-check exist).

**Confidence scoring:**
- TASK 0/1 correct, real parsing (or careful regex avoiding tonight's own false-positive shapes), correctly handles mutual-exclusion (35 pts)
- TASK 2 genuinely wired into real CI, warn-not-block, visible output (30 pts)
- TASK 3 real full-file run, correctly silent on /user/, confirms both tonight's fixes are clean, honestly reports any new findings (35 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
