# Outbox — team_form CONTEXT_SOURCE (close the recent-form gap)

**Date:** 2026-07-01
**Relay HEAD:** 5981d3c
**CC-CMD:** docs/CC-CMD-2026-06-30-team-form-context-source.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `CONTEXT_SOURCES` location | `src/context-assembler.js:861`. Registry array starts there. |
| `buildBSDHistoryContext` | Defined at L657, ends at L856. Insertion point for `buildTeamFormContext`: immediately after L856 (the closing `}` of `buildBSDHistoryContext`), before the `// ── Source registry` comment at L858. |
| Bosnia in identity-resolver.js | Zero occurrences. Confirmed: no entries existed before this commit. |
| `CANONICAL` pattern | L31–295. Pairs array, WC section at L35. Insertion point: after `['Curacao', 'Curaçao']` at L53, before the `// ── EPL` comment at L55. |
| Export block shape | Found via `tail -25`. Style: `export { ... }` with one export per line, closing `};`. Last entry was `buildBSDHistoryContext,`. |
| Registration insertion point | After `bsd_history` at L930-931, before `golf_leaderboard` comment at L932. |

**Fix 1 (D1 data) status:** NOT touched by this CC-CMD. The `UPDATE regular_season_games SET home = 'Bosnia and Herzegovina' WHERE home = 'Bosnia-Herz'` was already applied chat-side on 2026-06-30. This CC-CMD covers code only (Fix 2).

---

## What Was Built

### Task 1 — `src/identity-resolver.js`: Bosnia CANONICAL entries

Added four variant → canonical pairs in the WC section after `Curaçao`:

```js
['Bosnia and Herzegovina', 'Bosnia and Herzegovina'],
['Bosnia-Herzegovina',     'Bosnia and Herzegovina'],
['Bosnia & Herzegovina',   'Bosnia and Herzegovina'],
['Bosnia-Herz',            'Bosnia and Herzegovina'],
```

Fixes `teamNameMatch()` for the BSD/Odds join. Needed independently of the D1 name correction — both fixes are required for correct end-to-end matching.

### Task 2 — `src/context-assembler.js`: builder + sport map + registration + export

**`_TEAM_FORM_SPORT_MAP`** and **`buildTeamFormContext()`** inserted after `buildBSDHistoryContext` closes (L856), before the source registry comment. The builder:
- Guards on `env.ARCHIVE_DB` and sport map membership (returns `''` if either missing)
- Resolves team name from `game.home?.name || game.home` (handles both object and string forms)
- Runs two parallel D1 queries for last 5 completed games per team (home_score IS NOT NULL)
- `fmt()` helper computes W/L/D per game, totals, averages; returns null if no rows (filtered before join)
- Returns `[TEAM FORM]\n{home line}\n{away line}` or `''` if no data for either team
- Full try/catch wrapping — any D1 error returns `''` (Rule 5)
- No drama values computed (Rule 47/ADR-002) — only factual W/L/score/opponent history

**Registration** inserted after `bsd_history` (priority 7), before `golf_leaderboard` (priority 3):
```js
{ id: 'team_form', priority: 9, budget: 200, builder: buildTeamFormContext,
  sports: ['mlb', 'wnba', 'wc26', 'afl', 'cfl',
           'epl', 'mls', 'ucl', 'laliga', 'seriea', 'bundesliga', 'ligue1'] }
```

Excluded per spec: `pga`/`atp`/`wta` (non-matchup format). `nhl`/`nba` confirmed still zero rows as of 2026-06-30 — excluded, add when season starts.

**Export** updated: `buildTeamFormContext` added after `buildBSDHistoryContext` in the `export { ... }` block, matching existing one-per-line style.

---

## Deviation from Spec

None. The spec's exact function body and sport map were ported verbatim. The only check required was confirming the real insertion points (probed from source, not assumed) — all matched the spec's described locations.

---

## Deploy

- Commit: `5981d3c`
- Files changed: `src/context-assembler.js` (+81 lines), `src/identity-resolver.js` (+4 lines)
- Workflow run: `28536320136`
- CI conclusion: `success`

---

## Chat-Side Follow-Ups (NOT part of CC-CMD done condition)

CC's egress blocks `*.workers.dev`. Live verification requires:

1. **`/v2/games?sport=mlb`** returns 200 with game data
2. **`/v2/games?sport=wc26`** returns 200 with game data
3. **`[TEAM FORM]` block in journalism context:** for an upcoming WC26 or MLB game with `home_score IS NOT NULL` rows in `regular_season_games`, the journalism prompt should include the `[TEAM FORM]` block. Check via `mcp__FIELD_Handoff__probe_relay_route` or a direct journalism generation call.
4. **Bosnia match:** if a WC26 fixture with Bosnia appears, confirm `teamNameMatch()` resolves correctly via the Odds API join path.
