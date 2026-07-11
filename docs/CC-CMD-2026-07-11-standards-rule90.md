# Claude Code Command — Rule 90: mechanical rule-compliance tracking (replaces the self-report version)

**Date:** 2026-07-11
**Repo:** THIS FILE (jubilant-bassoon) covers TASKS 1-2. TASK 3 is pushed as an identical copy to field-relay-nba/docs/ — same filename — since it requires CI changes in that repo. Read the task labels below; execute only the tasks matching the repo you're running in.
**Scope:** The Rule 90 committed earlier tonight relied on a future session remembering to self-report whether the rule was exercised — the exact failure mode it was meant to fix, just moved one level up. This replaces it: every new STANDARDS.md rule gets a machine-tracked registry entry, and a CI check (same mechanism as the existing confidence-gate scanner) fails when an entry sits unexercised too long. No session has to remember anything for this to work.
**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md first.

Write findings to outbox/cc-standards-rule90-mechanical-2026-07-11.md.

## TASK 1 (jubilant-bassoon) — Replace Rule 90's text in STANDARDS.md

Find the existing "Rule 90 — New-rule compliance followup" section (added earlier this session) and replace its full body with:

```
## Rule 90 — Mechanical rule-registry tracking (RULE-COMPLIANCE-FOLLOWUP-A)

Every new rule added to STANDARDS.md gets a matching entry:
codex_write(category:"rule-registry", key:"rule-{N}", title:"UNEXERCISED -- Rule {N}: {one-line summary}")
committed in the SAME session that adds the rule text -- not deferred.

The moment a session finds a real case where the rule applied (or was
violated), it flips the SAME key: title:"EXERCISED -- Rule {N}: {what
happened, date}" or title:"VIOLATED -- Rule {N}: {what happened, date}".

A CI check (field-relay-nba, same mechanism and cadence as the
existing confidence-gate scanner in post-deploy-live-verify.yml) scans
codex for category="rule-registry" entries still titled "UNEXERCISED"
past 14 days from their own updated_at, and fails the check if any
exist -- surfacing the gap as a build failure, not something a future
session has to remember to notice.

### Why this matters

The prior version of this rule asked a future session to remember to
self-report compliance -- the identical structural failure the rule
existed to fix, just relocated. A rule either produces a checkable
artifact or it does not get enforced at all; there is no third
category where "a session should remember" counts as enforcement.
This generalizes the exact mechanism already proven for
stale_pending_cc_cmds and the confidence-gate scanner -- both already
demonstrate that a machine watching a D1-backed registry works, and
that a session's memory is not required for it to work.

### Operational rules

1. Registering a new rule in the codex is not optional and is not a
   separate step to remember later -- it happens in the same commit
   sequence that adds the rule text, same session.
2. The 14-day staleness window is a default, not a guarantee of
   correctness -- if a rule genuinely has no applicable case in that
   window, the CI failure is the correct, honest signal to surface
   that, not a false alarm to suppress.
3. This does not retroactively register every existing rule (1-88) --
   explicitly out of scope, would become a task that never completes.
   Applies from Rule 89 onward. Rule 89 itself must be registered as
   part of TASK 2 below.
4. If a rule is found VIOLATED (not just unexercised), record it as
   such in the same registry entry -- do not silently correct and move
   on, matching this document's existing incident-style rules (45, 47,
   61, 67, 80, 81).
```

## TASK 2 (jubilant-bassoon) — Register Rule 89 in the codex, right now, as this CC-CMD's own first real use of Rule 90

Confirm Rule 89 (scoped-tool-default) is present in STANDARDS.md (added earlier this session). Call:
`codex_write(category:"rule-registry", key:"rule-89", title:"UNEXERCISED -- Rule 89: prefer a scoped MCP tool over any credential handoff to a session, even short-lived")`

This makes Rule 89 the first real entry in the registry TASK 1 just created the mechanism for — do not skip this because it feels redundant with writing the rule itself. The registry entry is the artifact; the STANDARDS.md text is not.

## TASK 3 (field-relay-nba) — Add the CI staleness check

In `.github/workflows/post-deploy-live-verify.yml`, add a new step alongside the existing "Check for confidence-gate violations" step (same job, same triggering pattern — do not create a new workflow file):

1. Query codex (D1, `ARCHIVE_DB`, same database the existing confidence-gate step already reads from) for rows where `category = 'rule-registry'` and `title LIKE 'UNEXERCISED%'`.
2. For each such row, compare `updated_at` to now. If more than 14 days have elapsed, fail the step (exit 1) and print the rule key + title in the failure output.
3. If zero rows are stale, the step passes silently — same behavior pattern as the existing confidence-gate check on a clean run.
4. Use the exact same D1 query pattern and step structure the confidence-gate check already established — do not invent a new querying approach for this.

## VERIFICATION

- jubilant-bassoon: `git diff` shows the Rule 90 section replaced (not duplicated — confirm the old self-report version is gone, not left alongside the new one). `codex_search("rule-89")` returns the real registered entry, not a simulated one.
- field-relay-nba: the new CI step genuinely added to the real workflow file, verified via a real trigger — construct a real test row (`category:"rule-registry"`, an `updated_at` deliberately more than 14 days in the past) and confirm the check fails on it, then confirm it does NOT fail on a fresh (today's) entry. Clean up the test row afterward.

## DONE CONDITION

Rule 90's text is the mechanical version, no self-report language remains. Rule 89 has a real, live registry entry. The CI staleness check exists in field-relay-nba, verified against both a real stale case and a real fresh case. Confidence ≥ 95 in each repo independently.

**Confidence scoring (jubilant-bassoon):**
- Rule 90 text fully replaced, old version not left in place (35 pts)
- Rule 89 genuinely registered via codex_write, confirmed via codex_search (35 pts)
- `git diff` clean, no unrelated changes (30 pts)

**Confidence scoring (field-relay-nba):**
- CI step added to the correct existing workflow, correct job (25 pts)
- Real D1 query against the actual rule-registry category, matching confidence-gate's pattern (25 pts)
- Positive test case (real stale row) confirmed to fail the check (25 pts)
- Negative test case (fresh row) confirmed to pass, test row cleaned up after (25 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.