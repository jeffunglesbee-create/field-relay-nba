# Claude Code Command — Merge shadowed MLB-Stats R2-first logic into the block that actually executes

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** merge two /mlb-stats/{file} route blocks into one. Zero client-side changes required (same URL shape, same response shape).

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/mlb-stats-r2-merge-2026-07-13.md.

## CONTEXT — real, confirmed shadowing, found by Cluster 5's empty-catch sweep

Two separate `/mlb-stats` route blocks exist in src/index.js:

- **Block 1 (~L11031, executes first):** broad `/mlb-stats*` handler. Has its own `MLB_ANALYTICS_FILES` check for 6 filenames (team_abs.json, expected_stats.json, sprint_speed.json, pitch_tempo.json, pitch_arsenals.json, umpire_abs.json) — serves them directly via GitHub raw (`raw.githubusercontent.com/.../outbox/mlb/{file}`) with an immediate `return`, before request handling can ever reach Block 2.
- **Block 2 (~L12253, dead for these 6 files):** narrower `/mlb-stats/{file}` handler with real, working R2-first logic (`env.FIELD_DATA.get('mlb/2026/' + file)`, falling back to the same GitHub raw URL on a miss) — genuinely unreachable for exactly the 6 filenames it exists to serve, because Block 1 already returned.

Per Block 2's own comment, the real intent was: *"R2-first... makes GitHub Actions mlb-weekly-update.yml optional (not a hard dependency)."* That intent has never actually executed.

**The fix:** transplant Block 2's R2-check into Block 1 (the block that actually runs), then remove Block 2 entirely. This is safe regardless of current R2 population — Block 2's own existing fallback logic (fall through to GitHub raw on an R2 miss) already handles an empty bucket correctly; merging it into Block 1 doesn't change that safety property, it just makes it reachable.

## TASK 0 — Probe (the real unblock criteria, not skipped)

1. **Map every caller/consumer of both blocks fresh.** Confirm both blocks are reached via the exact same URL shape (`/mlb-stats/{file}`) and that no other route in this file also matches `/mlb-stats/*` for these 6 filenames (re-grep, don't assume only these two blocks exist). Check `jubilant-bassoon`'s `index.html` for how these 6 files are actually fetched client-side (grep for the filenames or `/mlb-stats/`) — confirm the client only cares about the JSON body shape, not which internal path served it.
2. **Confirm whether R2 (`FIELD_DATA` bucket, key prefix `mlb/2026/`) is actually populated for these 6 files right now** — a real check (e.g. via the Cloudflare R2 API/MCP tooling available to this session, or by temporarily adding a diagnostic log and triggering a real request), not assumed either way. Document the real answer either way in the outbox — it doesn't change whether this fix ships (see safety argument above), but it's worth knowing.
3. Confirm `runMLBSavantUpdate()`'s real, current wiring (Monday cron and/or `/mlb-savant-update`) is what actually would populate this bucket, and whether it has ever genuinely run — read it fresh, don't assume from this doc's description.

## TASK 1 — Merge

In Block 1, when `MLB_ANALYTICS_FILES.includes(analyticsFile)` is true and the file isn't `umpire_abs.json` (matching Block 2's existing `!file.includes('umpire_abs')` exclusion — read Block 2 fresh to confirm whether that exclusion still makes sense or was itself a workaround worth re-examining, don't just copy it blindly): try the R2 read first (exact logic from Block 2, including its own try/catch and `[MLB-STATS-R2]` telemetry tag), fall through to the existing `relayFetch(rawBase...)` call on a miss or if the file is `umpire_abs.json`. Remove Block 2 entirely once its logic lives in Block 1. Zero changes to Block 1's other responsibilities (MLB Stats API proxying, `/homeRunDerby/` — added earlier tonight).

## TASK 2 — Verify

- Real live test: request each of the 6 filenames via the actual deployed relay, confirm all 6 still return correct, real JSON (byte-comparable to what they returned before this change, or explain any real, expected difference).
- If R2 was confirmed populated in TASK 0: confirm at least one file's response now genuinely comes from R2 (e.g. via the `X-Source: r2` header Block 2's logic already sets) rather than GitHub raw — a real, positive confirmation the merge activated the intended path, not just "didn't break."
- If R2 was confirmed empty in TASK 0: confirm the fallback path still works correctly and say so honestly rather than claim R2-sourcing was verified when it wasn't.
- `node --check` clean. `git diff` shows the merge is genuinely additive-to-Block-1 + Block-2-removal, no unrelated changes.
- Confirm zero regression to Block 1's other responsibilities (MLB Stats API proxy paths, homeRunDerby) via real live calls to at least one of those, not just code review.

## DONE CONDITION

One `/mlb-stats/{file}` route block, R2-first logic genuinely reachable, real live verification of all 6 filenames, honest reporting of whether R2 was actually populated and whether this fix was observed activating it or just correctly falling back.

**Confidence scoring:**
- TASK 0 real caller map, real R2-population check (not assumed), real confirmation of the population pipeline's actual status (35 pts)
- TASK 1 correct merge, preserves both blocks' real logic, doesn't blindly copy the umpire_abs exclusion without re-examining it (35 pts)
- TASK 2 real live verification of all 6 files, honest reporting on R2 activation either way, zero regression to Block 1's other routes confirmed live (30 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
