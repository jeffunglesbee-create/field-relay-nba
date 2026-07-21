# CC-CMD — Fix missing global allowlist entries blocking all tonight's /test/* probe routes

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — a real, genuine bug found via direct live verification

Direct `curl` against the live, deployed `/test/prefilter` route returned a
real `405 Method not allowed` — confirmed via direct inspection of the live
worker bundle: `src/index.js` has a separate, global method-allowlist gate
(~L11019) that runs before any specific route handler is reached. This gate
is a real, explicit, enumerated list — and it was never updated to include
any of tonight's `/test/*` probe routes, even though each route's own
specific handler was correctly added.

**Real, concrete consequence:** the pre-filter heuristic test's own "all 3
gates pass" result (`outbox/cc-session-2026-07-21-combined-prefilter-test.md`)
was based entirely on local Node.js regex execution, honestly described as
"deterministically identical to the deployed endpoint" — which is true for
the regex logic itself, but the actual live endpoint has never been
reachable at all. The combined-generate-judge test's own "STAGED, sandbox
egress blocked" finding may be partially or fully this same bug, not
(only) a sandbox-specific proxy restriction — confirm directly in Task 2
below rather than assume the prior session's diagnosis fully accounts for
this.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "Method not allowed" src/index.js
sed -n '11015,11036p' src/index.js
```

Confirm the real, current line numbers and exact structure fresh — this
doc's own line number (~11019) is from a live bundle inspection tonight,
not a guaranteed-current source line number.

---

## TASK 1 — Add the four missing routes to the global allowlist

Add, matching the exact existing pattern:
```js
&& !(pathname === '/test/workers-ai-judge' && request.method === 'POST')
&& !(pathname === '/test/gemini-judge' && request.method === 'POST')
&& !(pathname === '/test/combined-generate-judge' && request.method === 'POST')
&& !(pathname === '/test/prefilter' && request.method === 'POST'))
```

## TASK 2 — Real, direct, live verification

```bash
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/test/prefilter" \
  -H 'Content-Type: application/json' \
  -d '{"brief":"Wembanyama had 34 points and 12 rebounds tonight as San Antonio wins."}'
```
Confirm a real, structured JSON response (not "Method not allowed"),
matching the shape `{ skip: boolean, matchedPattern: string | null }`.

Also directly test `/test/combined-generate-judge` live — confirm whether
this specific bug was the actual cause of the prior session's "STAGED,
egress blocked" finding, or whether a real, separate sandbox restriction
also applies. Report honestly either way; don't assume this fix
automatically resolves that session's blocker without checking.

## TASK 3 — Re-run the pre-filter corpus test against the now-genuinely-live endpoint

Using the same real approach as the prior session (representative corpus,
honestly disclosed as such — the original B1-B10 texts are still not
stored in the repo, don't fabricate finding them), re-run Gates A/B/C
against the actual live endpoint, not local regex execution. Report
whether the result matches the local-execution result or differs — if it
differs, that's a real, important finding in itself (would mean the "code
is identical" assumption was wrong somewhere).

---

## DONE CONDITION

The four `/test/*` routes are genuinely reachable live (confirmed via
direct curl, not just code presence), and the pre-filter test's own gate
results are re-confirmed against the actual live endpoint rather than
local execution alone.

**Confidence scoring:**
- TASK 1 (30 pts): real, correct allowlist fix
- TASK 2 (35 pts): real, live verification of all four routes, honest assessment of whether this explains the combined-test's prior blocker
- TASK 3 (35 pts): real re-verification of pre-filter gates against the live endpoint, honest reporting if results differ from local execution

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
