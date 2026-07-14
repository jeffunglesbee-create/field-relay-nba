# Claude Code Command — Soccer league mislabel fix + permanent data-contract check

**Date:** 2026-07-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/soccer-league-label-2026-07-14.md. Commit the outbox manifest with `[skip ci]` in the message — it's a docs-only addition after the real fix commits are already in and deployed; do not let it re-trigger CI.

## CONTEXT

`adaptESPNWCSoccer` (src/index.js, ~L1371) was built solely for WC26 — its name, its default param `sportKey = 'wc26'`, and a hardcoded `league: 'FIFA World Cup'` a few lines into its return object all reflect that original, narrow scope. The June 26 2026 migration ("Club soccer — migrated June 26 2026: API-Sports → ESPN + BSD") routed 11 more competitions through this same function (EPL, MLS, UCL, Europa, Conference League, EFL Championship, League One, League Two, La Liga, Serie A, Bundesliga, Ligue 1) via the generic ESPN dispatcher at ~L3170 (`cfg.espnSport` not baseball/football/basketball/australian-football → `adaptESPNWCSoccer`). The hardcoded label was never revisited. Confirmed live today: all 4 real upcoming MLS games (July 16/17) return `league: "FIFA World Cup"`.

The fix itself is small — `sport: sportKey` is already correctly threaded on the line directly above the bug; `league` just needs the equivalent treatment. The larger, more important part of this CC-CMD is TASK 2: this bug produced **zero observable signal for three weeks** — no thrown exception, no failed request, HTTP 200 with valid-looking JSON the entire time. That's a fundamentally different failure class than an empty catch (nothing to log, because nothing ever fails) and needs a fundamentally different kind of fix: a standing check against the config table itself, not a try/catch.

## TASK 0 — Probe

Confirm fresh, do not trust this doc's line numbers once anything above them has changed:
```bash
grep -n "^function adaptESPNWCSoccer" src/index.js
grep -n "adaptESPNWCSoccer(" src/index.js   # every call site
grep -n "'epl':\|'mls':\|'ucl':\|'europa':\|'conference':\|'eflchamp':\|'eflone':\|'efltwo':\|'laliga':\|'seriea':\|'bundesliga':\|'ligue1':\|'wc26':" src/index.js   # full config table, confirm the current real list -- do not assume this doc's 12-entry list is still complete or unchanged
grep -n "EPL: 'epl'\|MLS: 'mls'" src/index.js   # existing reverse (name→key) map, check if a forward (key→name) version already exists nearby that TASK 1 should reuse rather than duplicate
cat .github/workflows/post-deploy-live-verify.yml   # read in full -- TASK 2 extends this, not a new workflow file
```
Read the full `adaptESPNWCSoccer` function body (not just the one hardcoded line) before touching it — confirm nothing else in the function has the same class of hardcoding hiding nearby.

## TASK 1 — Fix the label

Derive `league` from `sportKey` via a lookup, same treatment as the existing `sport: sportKey` line directly above it. Build (or extend, if TASK 0 finds a reusable forward map already exists) a `sportKey → real league display name` table covering every entry TASK 0 confirms in the config table — not just the ones this doc happened to list. `wc26` must still correctly produce `'FIFA World Cup'`; every other key must produce its own real name (`'Premier League'`, `'MLS'`, `'UEFA Champions League'`, etc. — match whatever naming convention the existing reverse map or client-side display already uses, do not invent new display strings if established ones exist).

## TASK 2 — Build the permanent data-contract check (the actual point of this CC-CMD)

This is a genuine design task, not a mechanical patch. The check needs to:
- Cover **every** `sportKey` with `espnLeague` set in the config table, read from the table itself (not a hardcoded list of the 12 found today) — so a future sport added to that table is automatically covered without anyone remembering to update a separate check.
- For each key, hit the real deployed `/v2/games?sport={key}&date={today}` and, only when `games` is non-empty (most leagues will have zero games on any given day — off-season, no fixtures scheduled — this must not be a failure), assert `games[0].league` matches the expected name for that key.
- Fail the workflow (real CI failure, not a warning) if any key with real games returns a mismatched label. This needs to be a gate that would have actually caught tonight's bug on July 16 before it reached three weeks of silent operation, not a check that only confirms today's specific fix.
- Extend `.github/workflows/post-deploy-live-verify.yml` (confirmed to exist and already run this exact live-endpoint-check-after-deploy pattern) rather than building a parallel workflow — follow its existing structure (the `outbox/live-verify-{run_id}.md` output pattern, the existing validation-check style).

State explicitly in the outbox why this design choice (read from the config table, not a hardcoded key list) is what makes this a permanent fix rather than a one-time patch for the 12 keys found today.

## TASK 3 — Verify

- `node --check src/index.js`: clean.
- Live check: `/v2/games?sport=mls&date=2026-07-16` and at least 2 other non-WC keys with real current data today — confirm real, correct league names, not `'FIFA World Cup'`.
- Confirm `wc26` itself is unaffected: still returns `'FIFA World Cup'` for a real WC game.
- Prove the new contract check actually catches the bug class it exists for: temporarily revert the label fix in a throwaway local copy (not committed), run the new check's logic against that reverted version, confirm it fails; confirm it passes against the real, fixed, deployed code. This is the test-the-test step — do not skip it just because the main fix already looks correct.
- Confirm the check correctly no-ops (does not fail) for a key with zero games today, proving the off-season case doesn't produce false failures.

## DONE CONDITION

Every soccer competition in the config table returns its own correct league name, verified live for at least 3 real keys including `wc26` itself. The new contract check is live in `post-deploy-live-verify.yml`, covers the full config table by reading it directly (not a hardcoded list), correctly no-ops on zero-game days, and was proven to actually catch the original bug shape before being proven to pass on the fix.

**Confidence scoring:**
- TASK 0 confirms the real, current function/config/existing-workflow state, not assumed from this doc (15 pts)
- TASK 1 correct label derivation for every real config-table entry, reusing an existing naming convention if one exists rather than inventing new strings (25 pts)
- TASK 2 the check reads the config table directly (not hardcoded), correctly handles zero-game days, extends the existing workflow rather than duplicating it, and the outbox states why this design is permanent not one-time (35 pts)
- TASK 3 real live verification across multiple keys, wc26 confirmed unaffected, and the check proven to actually catch the bug shape before being proven to pass (25 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
