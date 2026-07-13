# Claude Code Command — Relay empty-catch sweep, Cluster 2: handleJournalismCycle (28 sites, one function)

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** all empty catches within handleJournalismCycle only. Do not touch any other function.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/relay-empty-catches-cluster2-2026-07-13.md.

## CONTEXT — corrected count from Cluster 1, single largest concentration in the repo

Cluster 1 (already shipped, commit ca03cfb) found the AST-based empty-catch counting tool undercounted by not excluding comment-only bodies (`catch(_){/* comment */}` was wrongly counted as non-empty). Corrected, full-repo total is 118, not the original 50 — Cluster 1 covered 23 of those (golf handlers + handleV2Games). This cluster covers the single largest remaining concentration: handleJournalismCycle alone has 28 empty catches, more than any other function in the repo.

This is the relay's central function — the O(1) Newspaper Architecture cron (`*/15 * * * *`). P15B (earlier tonight) relocated its archive catch-up block ahead of the WC morning-brief guard; that fix is unrelated to and unaffected by this cluster. This CC-CMD's 28 sites are catches elsewhere in the same function — confirm fresh which, if any, overlap with anything P15B already touched before assuming independence.

**Standing lessons, all apply here, this function especially:**
- Read the WHOLE function before touching any single site — Cluster 1 found 5 catches in handleGolfEnriched where the doc only knew about 3, purely from reading the full function body. At 28 sites in one function, this matters even more.
- Comment-only catch bodies are empty — `catch(_){/* explanation */}` has zero runtime behavior despite having a comment.
- Established convention: `console.error("[TAG] message:", e.message)` — use `[JOURNALISM-CYCLE]` or a more specific per-section tag if the function's own internal structure (dead-hour block, morning-brief block, slate-generation block, etc.) warrants distinguishing them — your judgment, matching the file's existing style either way.
- Expect a real fraction to be genuinely, deliberately empty by design (this function has explicit "must not block journalism delivery" comments elsewhere in the file) — Cluster 1 found zero false positives in its batch, which the CC-CMD itself flagged as a deviation from the expected rate, not something to assume repeats here.

## TASK 0 — Probe

```bash
grep -n "async function handleJournalismCycle" -A 1200 src/index.js | grep -n "catch"
```

Map every catch in the function fresh, confirm real current line numbers (this doc's site list below is from a source snapshot pulled before this doc was written — re-verify, don't trust blindly). Read the whole function once, start to finish, before deciding on any individual site.

### Reference list (re-verify, do not trust as final)

Lines (relative to the fresh pull at CC-CMD write time): 5876, 5904, 5931, 5943, 5951, 5955, 5963, 5977, 5990, 5999, 6116, 6162, 6318, 6358, 6394, 6403, 6440, 6505, 6514, 6554, 6557, 6576, 6611, 6648, 6686, 6813, 6861, 6889 — 28 total.

## TASK 1 — Add telemetry to each confirmed-real gap

`console.error("[TAG] message:", e.message)` matching established convention. Zero behavior change otherwise.

## TASK 2 — Verify

- Real forced-condition test for at least the dominant pattern class in this batch (matching Cluster 1's own rigor — it identified the KV-read-fallback shape as the dominant pattern and did one real wrangler-tail forced-failure test covering it, rather than 23 separate live tests).
- Confirm genuine success behavior unchanged — this function runs live every 15 minutes; a regression here is high-blast-radius. Confirm via `probe_relay_route` or equivalent that `/journalism/tonight` still returns real, fresh content after this change.
- Run whatever test/lint mechanism this repo has for relay changes.

## DONE CONDITION

All real sites in handleJournalismCycle individually investigated (whole-function read, not per-line). Real gaps get real telemetry; correct exclusions documented with real reasoning. Zero caller behavior change. `/journalism/tonight` confirmed still producing real content post-deploy.

**Confidence scoring:**
- TASK 0 maps the real, full, current site list via full-function read, not the reference list alone (25 pts)
- TASK 1 correct for every confirmed-real gap, matches convention (35 pts)
- TASK 2 real forced test for the dominant pattern + live confirmation the core journalism cycle still works post-change (40 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
