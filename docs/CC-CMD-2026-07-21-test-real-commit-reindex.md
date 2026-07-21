# CC-CMD — Test whether a real commit resolves post-deploy-live-verify.yml's workflow_dispatch 422

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — precise, new evidence narrows this to one file

Tonight's PAT was missing `workflow` scope — confirmed the real root cause
of `deploy.yml`'s dispatch failures. Scope was added directly in GitHub's
UI. Immediate re-test: `deploy.yml` dispatches successfully with the same
token. `post-deploy-live-verify.yml` still returns the identical 422 with
the same, now-correctly-scoped token.

This rules out token/account-level causes entirely — the same token works
for one workflow and not the other in the same repo, same moment. The
remaining real difference: `post-deploy-live-verify.yml`'s primary trigger
is `workflow_run` (Deploy RELAY Worker completing), with `workflow_dispatch`
added as a secondary trigger with a comment reading "[re-index 2026-07-21]"
— itself added via a commit carrying `[skip ci]`, per direct git-log
inspection. Real, testable hypothesis: GitHub's trigger-metadata cache for
this specific file was never actually re-indexed, because the commit meant
to trigger that re-index was itself skip-ci'd.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
sed -n '1,10p' .github/workflows/post-deploy-live-verify.yml
```

Confirm the real, current trigger block fresh before editing.

---

## TASK 1 — Make a real, genuine (non-skip-ci) commit to the workflow file

Trivial, safe change only — e.g. update the "[re-index 2026-07-21]" comment
to reflect today's real attempt, or add a blank line. Commit WITHOUT
`[skip ci]` in the message. This is the one variable not yet tested: a
push-triggered (not skip-ci'd) change to this exact file.

## TASK 2 — Real, direct re-test after the commit lands

Confirm the commit is genuinely on `main`, then:
```bash
gh workflow run post-deploy-live-verify.yml --repo jeffunglesbee-create/field-relay-nba
```
Report the real, actual result. If GitHub's metadata re-indexing has a
propagation delay, wait a reasonable interval (e.g. 60s) and retry once
before concluding — note however long was actually waited.

## TASK 3 — Honest, complete report

State plainly whether this resolved it. If it did: the cause was
confirmed as the skip-ci'd re-index commit never actually taking effect.
If it didn't: report the real, current state and stop — do not speculate
further without new evidence. This is genuinely GitHub-side territory at
that point, and would need to be escalated as a direct question to Jeff
about whether he sees the same 422 (or a working "Run workflow" button)
in the GitHub UI directly for this specific workflow.

---

## DONE CONDITION

Either `workflow_dispatch` genuinely works on this specific workflow now
(confirmed via a real, successful trigger), or the hypothesis is
confirmed wrong with the real, current state honestly reported.

**Confidence scoring:**
- TASK 1 (30 pts): real, correct, minimal, non-skip-ci commit
- TASK 2 (45 pts): real, direct re-test with actual result reported
- TASK 3 (25 pts): honest, complete final state, no forced conclusion

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
