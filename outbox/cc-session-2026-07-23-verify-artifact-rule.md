# CC Session — VERIFY-ARTIFACT-A rule addition
**Date:** 2026-07-23
**CC-CMD:** jubilant-bassoon docs/CC-CMD-2026-07-23-verify-artifact-rule.md
**Repos:** jubilant-bassoon (Rule 90, primary), field-relay-nba (Rule 89, cross-reference)

## HEAD Progression

**jubilant-bassoon:**
- 6ff4087: docs: Rule 90 VERIFY-ARTIFACT-A [skip ci] [no-verify: ...]

**field-relay-nba:**
- 00827d9: docs: Rule 89 VERIFY-ARTIFACT-A cross-references jubilant-bassoon Rule 90 [skip ci]

## Rule number assigned

**Rule 90** in jubilant-bassoon (confirmed from `grep -n "^### Rule [0-9]" CLAUDE.md | tail -5` — highest was 89).
**Rule 89** in field-relay-nba (confirmed from grep — highest was 88; Rule 89 RENDER-CHROME-A was not carried into relay as it is client-specific).

## TASK 2 — field-relay-nba check

field-relay-nba maintains its own numbered sequence (Rule 87 SELF-COMPLETE-A, Rule 88 CORRECT-FAST-A) — independently copied, not deferred to jubilant-bassoon. Per CC-CMD TASK 2: added equivalent Rule 89 to field-relay-nba, cross-referencing jubilant-bassoon's Rule 90 for full rationale and the visual/Playwright corollary (explicitly noted as client-specific, not applicable to relay).

## Final rule text as committed

### jubilant-bassoon Rule 90 (VERIFY-ARTIFACT-A)

> A CC-CMD task or Done Condition that says "verify," "confirm," "test," or
> "check" a behavior, without also specifying the concrete,
> externally-checkable thing that must exist afterward as proof, is
> satisfiable without actually proving the claim. This pattern has recurred
> under several names in this project's own history: Rule 87's own violation-
> signals list ("verification steps blocked by sandbox egress") accepted as a
> stopping point rather than routed around; the regex-anchoring rule; 
> `rule-gha-for-sandbox-egress-blocks`; and most directly, the ambient-panel
> skeleton bug.
>
> The fix: every verification instruction states what artifact proves it. 
> Accepted forms: a specific curl response field that must NOT equal a 
> known-bad string; a committed screenshot at a named URL/viewport/state; 
> an enumerated set of input/output pairs that must all pass; a diff showing 
> exactly N lines changed in exactly these files. "Looks right" and "works" 
> are not artifacts. This rule binds chat's CC-CMD authoring as much as CC's 
> execution — a vague verification task is a spec failure when written.
>
> Visual/rendering bugs specifically require the CI-as-proxy Playwright pattern:
> a dedicated GHA workflow triggered by outbox/.trigger-* push, running against
> the LIVE deployed URL, committing screenshots + a structured boolean manifest
> to outbox/. See ambient-skeleton-probe.yml as reference implementation.

### field-relay-nba Rule 89 (VERIFY-ARTIFACT-A)

Abbreviated version covering the core principle; cross-references jubilant-bassoon Rule 90 for full rationale and Playwright corollary.

## Pre-existing smoke failure noted

jubilant-bassoon smoke A190/A515 failing pre-change: SW_VERSION mismatch (sw.js=`2026-07-23a` vs index.html=`2026-07-21b`). Out of scope for this CLAUDE.md-only CC-CMD. Committed with `--no-verify` per Rule 16 with documented reason. Requires a separate SW_VERSION sync commit.

## Confidence Score

- Correct rule number confirmed from HEAD grep (+30): ✅ Rule 90 jubilant-bassoon, Rule 89 field-relay-nba
- All substantive points preserved (+40): ✅ artifact-not-action principle, historical citations, Playwright corollary, binds chat authoring
- TASK 2 genuinely checked (+20): ✅ field-relay-nba has own numbered sequence → own rule added with cross-reference
- Clean commit (+10): ✅ both repos committed with [skip ci], rule text matches committed state

**Total: 100/100**

## Carry-Forwards

- Pre-existing SW_VERSION mismatch (jubilant-bassoon): sw.js=2026-07-23a vs index.html=2026-07-21b — requires separate sync commit.
