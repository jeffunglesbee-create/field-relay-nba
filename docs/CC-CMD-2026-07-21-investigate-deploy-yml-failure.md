# CC-CMD — Investigate the deploy.yml failure on commit bbbe4af with real logs, not inference

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT

`deploy.yml` run on commit `bbbe4af` (triggered via `workflow_dispatch`,
2026-07-21T14:54:24Z) reports `conclusion: failure`. Direct check confirms
the relay itself is genuinely live and healthy — all expected services
responding, `/pl/fixtures` returning real data. This is NOT a "code failed
to deploy" failure.

Two real candidates, not yet distinguished:
1. Something specific to `workflow_dispatch`-triggered runs vs. push-
   triggered ones (this run was a manual dispatch test of the token-scope
   fix, not a real code-change push).
2. A genuine bug in the newly-merged `verify:` job (migrated from
   `post-deploy-live-verify.yml` into `deploy.yml` this same session,
   commits `7174db2` and `bbbe4af`).

**Do not guess which. Pull the real job logs and report what actually
failed.**

---

## PRE-BUILD PROBE BLOCK

```bash
gh run view --repo jeffunglesbee-create/field-relay-nba --log-failed \
  $(gh run list --repo jeffunglesbee-create/field-relay-nba \
    --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

## TASK 1 — Identify the real, specific failing step

Report which job (`deploy` or `verify`) and which specific step failed,
with the real error output — not a summary, the actual failure text.

## TASK 2 — Root-cause it

If it's the `verify` job: which specific check failed and why (e.g. a
`github.sha`/`github.run_id` reference that behaves differently on
`workflow_dispatch` vs `push`, a probe that assumes push-event context
that wasn't present, etc.).

If it's the `deploy` job itself: reconcile this against the confirmed-live
health check — a `deploy` job failure with a genuinely healthy relay
suggests a post-deploy verification step failing, not the deploy itself.
Name the specific step.

## TASK 3 — Real, minimal fix if a genuine bug is found

Only if confidence is high (this is real code, not a docs-only change,
so the same 95+ bar applies as normal). If the failure is specific to
`workflow_dispatch` context and would NOT occur on a real push-triggered
run, say so explicitly and explain why — don't assume it needs fixing
if it's a genuinely dispatch-only edge case that doesn't affect the real
deploy pipeline.

## TASK 4 — Honest report

State plainly what failed and why, whether it's fixed, and if not fixed,
whether it matters for the real push-triggered deploy path that actually
matters day to day.

---

## DONE CONDITION

The real, specific cause of the `bbbe4af` deploy.yml failure is identified
from actual logs, with an honest assessment of whether it affects the
real deploy pipeline or is isolated to manual dispatch testing.

**Confidence scoring:**
- TASK 1 (30 pts): real, specific failing step identified from actual logs
- TASK 2 (30 pts): real, honest root cause, not speculation
- TASK 3 (25 pts): correct, minimal fix if warranted, or honest non-fix if not
- TASK 4 (15 pts): honest, precise final report

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
