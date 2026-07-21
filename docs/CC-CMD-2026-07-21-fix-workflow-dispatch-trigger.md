# CC-CMD — Resolve the workflow_dispatch trigger mismatch on post-deploy-live-verify.yml

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — a real, confirmed mismatch, one untested hypothesis

Direct API test via `trigger_workflow` against `post-deploy-live-verify.yml`
returned a real 422: `"Workflow does not have 'workflow_dispatch' trigger"`.
Direct read of the live source on `main` shows it genuinely DOES declare
`workflow_dispatch:`, with a comment reading "[re-index 2026-07-21]" —
strongly suggesting a prior session already hit this exact problem today
and attempted the known GitHub Actions fix (a commit to force re-parsing of
trigger metadata). Re-test after that fix still returned the same 422.

**Real, untested hypothesis:** if that prior "[re-index]" commit was pushed
with `[skip ci]` in the message (the pattern used for most doc-only commits
tonight), it may have suppressed the very re-indexing it was meant to
trigger. This is a real, specific, testable theory — not confirmed.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline --all -- .github/workflows/post-deploy-live-verify.yml
git log -p -1 --follow -- .github/workflows/post-deploy-live-verify.yml | grep -A2 "re-index"
```

Confirm directly whether the commit that added the "[re-index 2026-07-21]"
comment carried `[skip ci]` in its own message — this determines whether
the hypothesis is even plausible before acting on it.

---

## TASK 1 — Make a real, genuine (non-skip-ci) commit to the workflow file

If the probe confirms the hypothesis (prior commit had `[skip ci]`): make a
real, trivial change to `.github/workflows/post-deploy-live-verify.yml`
(e.g. update the re-index comment's date, or add a blank line) and commit
it WITHOUT `[skip ci]` in the message. This is the real, known fix for
GitHub's trigger-metadata re-indexing.

If the probe does NOT confirm the hypothesis (prior commit had no
`[skip ci]`): report this honestly — the hypothesis was wrong, don't force
the fix anyway. Investigate further via `gh api` directly instead (real,
current trigger metadata: `gh api repos/{owner}/{repo}/actions/workflows`
and find the entry for this workflow, report its real, actual state).

## TASK 2 — Real, direct re-test after the fix lands

Confirm the commit is genuinely on `main` (not just staged), then test:
```bash
gh workflow run post-deploy-live-verify.yml --repo jeffunglesbee-create/field-relay-nba
```
Report the real, actual result — success or the same 422. If GitHub's
re-indexing has a real propagation delay, note that honestly and specify
how long was waited before the final report.

## TASK 3 — Honest, complete report

State plainly whether the fix worked. If it didn't, do not speculate
further in this CC-CMD — report the real, current state and stop, since
continued guessing without new evidence isn't useful.

---

## DONE CONDITION

Either `workflow_dispatch` genuinely works on this workflow now (confirmed
via a real, successful trigger), or the hypothesis is confirmed wrong and
the real cause remains honestly unresolved with next steps named.

**Confidence scoring:**
- TASK 1 (35 pts): real, correct probe of the hypothesis, honest fix or honest non-fix
- TASK 2 (40 pts): real, direct re-test with actual result reported
- TASK 3 (25 pts): honest, complete final state, no forced conclusion

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
