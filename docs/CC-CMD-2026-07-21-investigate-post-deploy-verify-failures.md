# CC-CMD — Pull real logs for the two post-deploy-live-verify failures and confirm the real cause

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT

Two consecutive `post-deploy-live-verify.yml` runs failed (commits `22ed3df`
and `e48c12b`, both ~01:00 UTC 2026-07-21). Direct, independent re-checks of
both underlying probes it runs (soccer league label live-comparison,
`/pl/fixtures` shape check) both pass cleanly right now, with real, current
data — no coverage gap, no label mismatch, no missing fields. This suggests
a real, likely-transient cause (deploy-timing race, cold-start, or similar)
rather than a genuine code/data defect — but this is an inference from
absence, not a confirmed fact. This CC-CMD exists specifically to get the
real, actual failure logs and either confirm or correct that inference.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -8
gh run list --workflow=post-deploy-live-verify.yml --limit 5
```

---

## TASK 1 — Pull the real, actual logs from both failed runs

Use `gh run view <run-id> --log-failed` (or equivalent GitHub API call) for
both failed runs tied to `22ed3df` and `e48c12b`. Report the real, exact
failure output verbatim — which specific step failed, what the actual
printed error/mismatch was.

## TASK 2 — Determine the real cause

Compare the real logged failure against tonight's own direct re-checks
(soccer label check: no mismatch found; `/pl/fixtures`: shape OK, 40
fixtures). If the logs show a real, different mismatch than what's true
now, that confirms a genuine transient issue (data changed between the
failed run and now) — name what specifically differed. If the logs show
something structurally different (a real error, not a data mismatch),
report that honestly instead — don't force the "transient" explanation
if the actual logs don't support it.

## TASK 3 — Honest report, no forced conclusion

Report the real, confirmed cause. If genuinely transient (and confirmed
as such from the actual logs, not assumed), no code change is needed —
say so plainly. If the logs reveal a real, still-present defect, write a
follow-up CC-CMD to fix it — do not fix speculatively in this CC-CMD
without first confirming via the real logs what's actually broken.

---

## DONE CONDITION

The real, actual failure logs from both runs have been read and reported
verbatim, with an honest, log-grounded conclusion about the cause —
transient or genuine defect — not an inference presented as more certain
than it is.

**Confidence scoring:**
- TASK 1 (50 pts): real, actual logs retrieved and reported verbatim
- TASK 2 (30 pts): real, honest comparison against current state
- TASK 3 (20 pts): honest conclusion, follow-up only if logs support a real defect

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
