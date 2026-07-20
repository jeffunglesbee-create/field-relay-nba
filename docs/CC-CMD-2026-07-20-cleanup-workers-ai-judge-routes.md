# CC-CMD — Remove dead-end Workers AI judge test infrastructure

**Date:** 2026-07-20
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — a real gap in the original test plan's own closure logic

`outbox/cc-session-2026-07-20-workers-ai-judge-test-plan.md`'s Step 5
instructions say to remove `/test/workers-ai-judge`, `/test/gemini-judge`,
and the `[ai]` binding "if Step 5 is authorized." Step 5 was explicitly
NOT authorized (the investigation concluded "not viable," verified
2026-07-20) — meaning nothing in the plan actually triggers cleanup for
the negative-result path. These routes are real, live, publicly-reachable
endpoints left in production with no active owner and no closure
condition as written.

**Real, explicit scope boundary — do not touch the newer, still-active
investigation:** `/test/combined-generate-judge` and `/test/prefilter`
(added `b7edca1`, Step 2 of the two newer, still-in-progress plans) are
NOT in scope for this cleanup — those investigations are still running.
Only the concluded, dead-end Workers AI judge routes are being removed
here.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "/test/workers-ai-judge\|/test/gemini-judge" src/index.js
grep -n "\[ai\]" wrangler.toml
```

Confirm these routes are genuinely still present and unused by any real,
active production code path before removing — re-verify fresh, don't
assume tonight's description is still accurate.

---

## TASK 1 — Remove the two dead-end probe routes

Remove `/test/workers-ai-judge` and `/test/gemini-judge` from `src/index.js`
and their `ALLOWED_EXACT` entries. Confirm neither is referenced anywhere
else in the codebase before removing (a real grep for the route strings,
not an assumption).

## TASK 2 — Remove the `[ai]` binding

Remove from `wrangler.toml`, confirmed unused by any other real, active
code path first (the newer combined-generate-judge/prefilter routes do
NOT use the `AI` binding — they call Gemini via the existing `callProxy`,
confirm this directly rather than assume).

## TASK 3 — Real, direct verification

```bash
node smoke.js 2>&1 | tail -3
curl -s -o /dev/null -w "%{http_code}\n" "https://field-relay-nba.jeffunglesbee.workers.dev/test/workers-ai-judge"
```
Confirm the route genuinely returns 404 (or equivalent not-found) live,
not just that the code was removed locally.

---

## DONE CONDITION

The two dead-end test routes and the now-unused `[ai]` binding are
genuinely removed, verified live (real 404, not just local code absence),
with the still-active combined-generate-judge/prefilter investigation
routes explicitly confirmed untouched.

**Confidence scoring:**
- TASK 1 (40 pts): real, confirmed-safe removal of both dead routes
- TASK 2 (30 pts): real, confirmed-safe binding removal
- TASK 3 (30 pts): real, live verification, not just local

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
