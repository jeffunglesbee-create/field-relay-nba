# WC Czechia duplicate standings — relay fix + D1 migration 2026-06-18

## Bug

`/wc/standings` Group A returned 5 rows: Czechia at 1 game and "Czech
Republic" at 1 game, instead of one Czechia row at 2 games. Root cause:
API-Sports sends inconsistent team-name variants across matches.
`writeWCResult` stored `game.home?.name` / `game.away?.name` raw without
normalization. `recomputeGroupStandings` aggregates by team name in SQL,
so two name variants → two standings rows.

## Fix (commit `b835aa8`)

New `WC_NAME_FIX` map + `wcFixName()` helper inserted just above
`writeWCResult` at `src/index.js:1389`. Mirrors the client's
`_WC_NAME_FIX` in jubilant-bassoon:

```js
const WC_NAME_FIX = {
    'Czech Republic':       'Czechia',
    'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
    'USA':                  'United States',
    'Turkey':               'Türkiye',
    'Curacao':              'Curaçao',
    "Cote D'Ivoire":        'Ivory Coast',
    'Korea Republic':       'South Korea',
    'Cape Verde Islands':   'Cape Verde',
};
function wcFixName(n) { return WC_NAME_FIX[n] || n; }
```

Applied at four call sites (all inside the WC results write path):

| Site | Before | After |
|------|--------|-------|
| `writeWCResult` → `extractWCGroup` | raw `game.home?.name`, `game.away?.name` | `homeName`, `awayName` (normalized) |
| `writeWCResult` → `INSERT OR IGNORE INTO wc_results` | raw | normalized |
| `writeWCResult` → BracketDO `bracket/result` POST | raw | normalized |
| `handleWCAdminSeed` → `INSERT OR REPLACE INTO wc_results` | raw `home`, `away` from POST body | `homeFixed`, `awayFixed` |

`extractWCGroup` already tolerated both "Czechia" and "Czech Republic"
in its `_WC_TEAM_GROUP` lookup, so group inference still works during
the transition. The normalization is defense-in-depth.

## D1 migration (one-time)

The relay fix prevents new bad data. Existing rows in `wc_results` and
`wc_group` must be cleaned. Recommended sequence (run against
`ARCHIVE_DB`'s WC2026_DB binding — `field-d1` / `wc2026`):

```sql
-- 1. Rewrite stale alias rows
UPDATE wc_results SET home = 'Czechia' WHERE home = 'Czech Republic';
UPDATE wc_results SET away = 'Czechia' WHERE away = 'Czech Republic';

UPDATE wc_results SET home = 'Bosnia and Herzegovina' WHERE home = 'Bosnia & Herzegovina';
UPDATE wc_results SET away = 'Bosnia and Herzegovina' WHERE away = 'Bosnia & Herzegovina';

UPDATE wc_results SET home = 'United States' WHERE home = 'USA';
UPDATE wc_results SET away = 'United States' WHERE away = 'USA';

UPDATE wc_results SET home = 'Türkiye' WHERE home = 'Turkey';
UPDATE wc_results SET away = 'Türkiye' WHERE away = 'Turkey';

UPDATE wc_results SET home = 'Curaçao' WHERE home = 'Curacao';
UPDATE wc_results SET away = 'Curaçao' WHERE away = 'Curacao';

UPDATE wc_results SET home = 'Ivory Coast' WHERE home = "Cote D'Ivoire";
UPDATE wc_results SET away = 'Ivory Coast' WHERE away = "Cote D'Ivoire";

UPDATE wc_results SET home = 'South Korea' WHERE home = 'Korea Republic';
UPDATE wc_results SET away = 'South Korea' WHERE away = 'Korea Republic';

UPDATE wc_results SET home = 'Cape Verde' WHERE home = 'Cape Verde Islands';
UPDATE wc_results SET away = 'Cape Verde' WHERE away = 'Cape Verde Islands';

-- 2. Delete stale wc_group rows for the affected groups (will be recomputed)
DELETE FROM wc_group WHERE group_id IN ('A','B','D','E','H');
```

Step 3 — recompute affected groups (one of the following):

a) Hit `POST /wc/admin/seed` for one already-stored result per affected
   group (it calls `recomputeGroupStandings`), or
b) Trigger a fresh writeWCResult by re-pushing any final game in that
   group via the ambient cron, or
c) Inline call `recomputeGroupStandings(db, 'A')`, repeat for each
   affected group via a one-off admin endpoint.

Simplest path: after deploy, no action needed for groups where future
matches will recompute standings naturally. For groups with only past
matches and no upcoming ones in the next 24h, run (a) or (c).

## Verification (after migration)

```bash
curl -s 'https://field-relay-nba.jeffunglesbee.workers.dev/wc/standings?group=A' \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
rows=d.get('standings') or d.get('rows') or []
print(f'Group A rows: {len(rows)}')
for r in rows:
    print(f\"  {r.get('team')}: P{r.get('played')} W{r.get('won')} D{r.get('drawn')} L{r.get('lost')} pts={r.get('points')}\")
assert len(rows) == 4, f'expected 4 Group A rows, got {len(rows)}'
czechia = next((r for r in rows if r.get('team') == 'Czechia'), None)
assert czechia is not None, 'Czechia not found'
print('OK — Czechia present, Group A has 4 rows')
"
```

Expected: Group A → 4 rows. Czechia → P:2 W:0 D:1 L:1 (per bug report).
No "Czech Republic" row.

## What was NOT changed

- `extractWCGroup` and `_WC_TEAM_GROUP` — both already tolerated the
  alias variants; no churn there.
- Client (jubilant-bassoon) — handled by separate defensive merge per
  bug description; this relay fix is complementary.
- ADR-002 boundary — no drama scoring, no editorial computation.
- `WC_TEAM_CONTEXT` / `wc-team-context.js` — already keyed on canonical
  FIELD names; no normalization needed there.
- Stat repo — out of scope.

## Commits

| SHA | Description |
|---|---|
| `b835aa8` | `WC_NAME_FIX` map + `wcFixName()` applied at 4 write sites |
