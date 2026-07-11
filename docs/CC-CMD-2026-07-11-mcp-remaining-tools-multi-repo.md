# Claude Code Command — Extend every remaining jubilant-bassoon-only MCP tool, not just the one that was hit

**Date:** 2026-07-11
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Scope:** `get_ci_status`/`get_deploy_status` are hardcoded to jubilant-bassoon, same as `commit_file`/`read_file`/etc. were before tonight's earlier fix — but they were out of scope for that fix and nobody checked whether other tools shared the gap. This has now been hit twice tonight (once needing field-relay-nba's own deploy state, once just now checking its CI status) via manual D1/archive workarounds instead of the tool that should exist. Fix the whole class in one pass: audit every MCP tool for the same hardcoding, extend all of them together, so this stops being discovered one tool at a time.

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md and STANDARDS.md Rule 89 before touching this.

Write findings to outbox/cc-mcp-remaining-tools-multi-repo-2026-07-11.md.

## TASK 1 — Full audit: every MCP tool still hardcoded to one repo

Grep the entire MCP handler source for every tool definition. For each, determine: does it reference a repo at all (some tools — D1/codex/sports-data tools — genuinely have no repo concept and are correctly out of scope)? If it does reference a repo, is it parameterized (already fixed, like `commit_file`) or hardcoded (still needs this fix)? Report the full list explicitly — do not assume `get_ci_status`/`get_deploy_status` are the only two; this is exactly the kind of assumption that caused the gap to sit undiscovered until hit by accident twice.

## TASK 2 — Extend every hardcoded tool found in TASK 1

Same pattern already established and proven tonight for `commit_file`/`read_file`/`read_source`/`read_lines`/`get_archive_url`: add an optional `repo` parameter (`jubilant-bassoon`|`field-relay-nba`, default `jubilant-bassoon`), reuse the existing `repoApiFor()` resolver — do not invent a second repo-resolution pattern. Every existing caller that omits `repo` must behave byte-identically to today.

## VERIFICATION

- For each tool extended: call it once with no `repo` param (confirm jubilant-bassoon behavior unchanged) and once with `repo: "field-relay-nba"` (confirm it returns real field-relay-nba data, not an error or jubilant-bassoon data mislabeled).
- Specifically for `get_ci_status`/`get_deploy_status` against field-relay-nba: confirm the returned run data is real and current — cross-check against a commit hash known to be on field-relay-nba's actual HEAD, not a stale or cached response.
- Confirm TASK 1's audit was genuinely complete — re-grep after TASK 2's changes and confirm zero remaining hardcoded-repo tools exist, not just the ones this doc named going in.

## DONE CONDITION

Every MCP tool with a repo concept supports both repos. `get_ci_status`/`get_deploy_status` (and anything else TASK 1 found) work correctly against field-relay-nba, verified live. No tool with a repo concept remains hardcoded. Confidence ≥ 95.

**Confidence scoring:**
- TASK 1 audit genuinely complete, full tool list reported, not assumed to be just the two named (30 pts)
- TASK 2 every found tool extended, same resolver reused, no second pattern invented (30 pts)
- Live verification against field-relay-nba for each extended tool, cross-checked against a known-real commit (25 pts)
- Post-fix re-audit confirms zero remaining hardcoded tools (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.