# Claude Code Command — Upsert /archive/game postseason rows by series_key+round+game_number, not team names (relay repo)

**Date:** 2026-07-15
**Repo:** field-relay-nba (sole — this is the `/archive/game` route handler's own D1 write logic; do not attempt this in jubilant-bassoon)
**Branch:** main — commit directly, do not create a feature branch or PR.

## CONTEXT — real gap found while executing CC-CMD-2026-07-15-telus-sf-duplicate-rows (jubilant-bassoon)

That CC-CMD fixed a real, observed duplication: `postseason_games` had 4 rows for `series_key='MLS-COM-00002V_SF-01'` instead of 2 — a stale `TBC Home`/`TBC Away` placeholder pair alongside the resolved `Vancouver Whitecaps FC` pair. Read the relay's real `/archive/game` handler directly (`mcp__FIELD_Handoff__read_file` against `src/index.js`, not the `read_source` search tool, which has repeatedly returned unreliable zero-hit results for terms confirmed to exist) and found the exact root cause:

```js
const shortify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const homeShort = shortify(home);
const awayShort = shortify(away);
const idTail = (homeShort && awayShort)
    ? `${homeShort}_${awayShort}`
    : (source_id ? `src${shortify(source_id)}` : `g${Date.now()}`);
const id = `${sport}_${date}_${idTail}`;
```

`postseason_games` **does** have a real `INSERT ... ON CONFLICT(id) DO UPDATE` upsert — but `id` is generated from the team names, not `series_key`. When a bracket slot resolves from a `TBC` placeholder to a real team name, `id` changes (`tbchome_cfmontral` → `vancouverwhitecapsfc_cfmontral`), so the resolved write inserts a new row instead of updating the placeholder one. Confirmed via a real, empirical re-run (jubilant-bassoon's `mls-tournaments-seed.yml`, dispatched twice, both live) that this duplication does **not** compound — the archived rows stayed stable at the correct count once the stale pair was manually deleted — but the same pattern **will recur** for `SF-02` and the `Final` in this same TELUS bracket once their own participants resolve later this year, and for any other multi-leg bracket (any sport) with a `TBC`-style placeholder-to-real-name transition. This is a real, predictable future recurrence, not speculative — the root cause is structural, not a one-time fluke.

The jubilant-bassoon-side fix was a one-off data cleanup (`DELETE` of the two confirmed-stale rows via direct D1 access) — correct for the already-observed case, but not a durable fix, since it doesn't change the relay's own ID-generation behavior that will reproduce this pattern again.

**Why this wasn't fixed directly in that dispatch:** the `id`-generation scheme shown above is shared identically across `postseason_games` AND `regular_season_games` (confirmed by reading the full route handler — the same `shortify`/`id` construction feeds both `INSERT` statements), and is used by every caller of `/archive/game` across the relay, not just the MLS tournament seed script. Changing it requires understanding every current caller to be confident a `series_key`-based id wouldn't break something relying on the current name-based scheme (e.g., a caller that intentionally wants each leg's write treated independently). That's a broader, riskier change than a narrowly-scoped jubilant-bassoon dispatch should attempt unilaterally — flagged here per Rule 70 (ATOMIC-A) instead.

## TASK 0 — Probe

Read the full real `/archive/game` handler again (it will have drifted slightly). Enumerate every real caller of `/archive/game` across the relay codebase (`grep -n "archive/game"` or equivalent) and confirm, for each, whether it passes `series_key`+`round`+`game_number` — if a caller genuinely never sets `series_key` (single-game archival, no bracket), the id must keep falling back to the current name-based scheme for that caller; only bracket-aware callers should benefit from the new key.

## TASK 1 — Fix

When `series_key` is present in the request body, change `id` generation to `${sport}_${series_key}_${round || 'r'}_${game_number ?? idTail}` (or an equivalently stable, series-scoped key — confirm the exact real column/field names and any existing uniqueness constraints on `postseason_games` before finalizing the format). When `series_key` is absent, keep the current name-based `id` exactly as-is (no behavior change for non-bracket callers). This makes a `TBC`→real-name transition correctly UPDATE the existing row via the SAME `ON CONFLICT(id) DO UPDATE` clause that already exists, instead of inserting a duplicate — home/away name changes become just another COALESCE'd field update, matching how score/venue/etc. already update in place.

## TASK 2 — Verify

Real forced-condition test: two sequential `/archive/game` POSTs for the same `series_key`+`round`+`game_number`, first with `TBC`-style placeholder names, second with real resolved names — confirm the second POST updates the same row (same `id`, same rowid) rather than creating a second one. Confirm a POST with no `series_key` still gets the current name-based `id` unchanged (non-bracket callers unaffected). If reachable, confirm against a real live D1 write (a disposable test series_key, cleaned up after) rather than asserting from code review alone.

## DONE CONDITION

A `series_key`-scoped multi-leg tie whose participant resolves from a placeholder name to a real one updates its existing row instead of creating a duplicate, verified via a real write-twice test. Every non-bracket caller's existing name-based `id` behavior is provably unchanged.

**Confidence scoring:**
- TASK 0 (30 pts): enumerates every real caller of `/archive/game`, confirms which do/don't pass `series_key`, not assumed
- TASK 1 (40 pts): correctly scoped — only `series_key`-bearing writes get the new key, non-bracket callers untouched
- TASK 2 (30 pts): real forced test proving the placeholder-to-real-name transition now updates in place; real live-write verification attempted if reachable

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
