# Claude Code Command — Resolve the real Rule 89 collision, prevent a second numbering authority from ever existing again

**Date:** 2026-07-11
**Repo:** TASKS 1-4 target jubilant-bassoon. TASK 5 targets field-relay-nba — this identical file is pushed to both repos; execute only the tasks matching the repo you're running in.
**Scope:** `docs/CLAUDE-CODE-PROMPT-RULES.md` independently minted its own "Rule 89 — Legible across scope (SCOPE-LEGIBLE-A)" on 2026-07-08, unrelated to tonight's Rule 89 (SCOPED-TOOL-DEFAULT-A) in STANDARDS.md. Confirmed real via direct read, not assumed. Root cause: this satellite document was built to mirror STANDARDS.md Rules 87/88 verbatim, then at some point started originating new rules locally instead of staying purely derivative — creating a second, uncoordinated numbering authority. Renumbering one rule fixes the symptom, not the cause. This CC-CMD does both: resolves the current collision, and makes a second numbering authority structurally impossible going forward.

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md, STANDARDS.md, and docs/CLAUDE-CODE-PROMPT-RULES.md in full before touching anything.

Write findings to outbox/cc-rule89-collision-resolution-2026-07-11.md.

## TASK 1 — Re-verify the collision from current HEAD

Confirm both "Rule 89" sections still exist as described (STANDARDS.md's SCOPED-TOOL-DEFAULT-A, and CLAUDE-CODE-PROMPT-RULES.md's SCOPE-LEGIBLE-A). Confirm STANDARDS.md's actual current highest rule number (should be 90 after tonight's work — verify, don't assume). Report any drift.

## TASK 2 — Canonicalize SCOPE-LEGIBLE-A into STANDARDS.md as Rule 91

Move the full "Rule 89 — Legible across scope (SCOPE-LEGIBLE-A)" section from CLAUDE-CODE-PROMPT-RULES.md into STANDARDS.md verbatim, renumbered to Rule 91, positioned after Rule 90. Preserve its full content exactly — the four-radii probe structure, the violation signals, the AmbientDO example — this is a real, substantive rule, not boilerplate; do not summarize or truncate it in the move.

## TASK 3 — Replace the satellite doc's local copy with a pointer

In CLAUDE-CODE-PROMPT-RULES.md, replace the full "Rule 89 — Legible across scope" section with a short cross-reference: "Rule 91 (SCOPE-LEGIBLE-A) — see STANDARDS.md for full text. [one-sentence summary]." This document keeps its role as a Claude-Code-specific reading companion; it stops being a place where rules originate.

## TASK 4 — Register Rule 91 in the codex rule-registry (Rule 90's own mechanism, applied to this move)

`codex_write(category:"rule-registry", key:"rule-91", title:"UNEXERCISED -- Rule 91: [SCOPE-LEGIBLE-A one-line summary]")`. This is not a retroactive registration of an old rule (Rule 90 explicitly scopes that out) — it's the registration of a rule at the moment it's actually canonicalized into STANDARDS.md, which is happening in this CC-CMD, right now.

## TASK 5 (field-relay-nba — this file is also pushed there identically; execute this task only when running in that repo) — make a second numbering authority structurally impossible

Add a new step in `.github/workflows/post-deploy-live-verify.yml`, alongside the existing confidence-gate step and the Rule 90 staleness-check step added earlier tonight (same job, same file — do not create a new workflow):

1. Fetch STANDARDS.md and docs/CLAUDE-CODE-PROMPT-RULES.md fresh from jubilant-bassoon's default branch (cross-repo read — use the same GitHub API pattern already used elsewhere in this file for cross-repo checks, authenticated the same way).
2. Grep both files for every `## Rule N` heading pattern.
3. For each N found, query the codex rule-registry (D1, same `ARCHIVE_DB` the confidence-gate and Rule 90 checks already read from) for a matching `rule-{N}` key.
4. Fail the step (exit 1, print the offending file + rule number for every unmatched N) if any `## Rule N` exists in either file with no matching registry entry.
5. Pass silently if every rule number found has a matching registry entry.

This makes "a rule number appears with no registry entry" a build failure the moment it happens, not something a session notices three days later by accident — which is exactly how this specific collision was actually found tonight.

## VERIFICATION

- `git diff` on jubilant-bassoon shows: Rule 91 added to STANDARDS.md verbatim, CLAUDE-CODE-PROMPT-RULES.md's local copy replaced with a pointer, nothing else touched.
- `codex_search("rule-91")` returns the real registered entry.
- Confirm no other `## Rule N` collisions exist between the two files — a full sweep, not just re-checking 89 specifically, since this exact failure mode (independent local numbering) could plausibly have produced more than one collision.
- For TASK 5's CI check: construct a real test (a scratch `## Rule 999` with no registry entry in a test copy) and confirm the check fails on it; confirm a real, registered rule number does not trigger a false positive.

## DONE CONDITION

Exactly one "Rule 89" exists across both documents (STANDARDS.md's SCOPED-TOOL-DEFAULT-A). SCOPE-LEGIBLE-A is Rule 91, canonically in STANDARDS.md, registered in the codex. A full sweep confirms no other collisions exist. A CI check now makes a future uncoordinated rule number a build failure, not a silent drift. Confidence ≥ 95.

**Confidence scoring:**
- TASK 1 re-verification against actual HEAD (10 pts)
- TASK 2 SCOPE-LEGIBLE-A moved verbatim, full content preserved (20 pts)
- TASK 3 satellite doc correctly reduced to a pointer, not left duplicated (15 pts)
- TASK 4 Rule 91 genuinely registered (10 pts)
- Full sweep for additional collisions performed, not just re-checking 89 (15 pts)
- TASK 5 CI check written and pushed to field-relay-nba, tested against both a real failure and a real pass case (30 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.