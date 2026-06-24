# CC-CMD: assembleContext Sport-Label Mismatch — WC Sources Firing
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Rule 87:** Self-completing.

---

## CONTEXT

`assembleContext` normalizes `game.sport` via `_SPORT_NORMALIZE`:
```javascript
const _raw = String(game.sport || '').toLowerCase();
const sport = _SPORT_NORMALIZE[_raw] || _raw;
```

`_SPORT_NORMALIZE` maps 'fifa world cup 2026' / 'fifa world cup' / 'world cup'
→ 'wc26'. But the journalism cron (L7780) passes `game.sport` raw from ESPN
data: `const sportLabel = game.sport || 'unknown'`. For WC games, ESPN returns
`game.sport = 'soccer'` — not 'fifa world cup'. So `_raw = 'soccer'`,
`_SPORT_NORMALIZE['soccer']` = undefined, `sport = 'soccer'`.

Filter: `CONTEXT_SOURCES.filter(s => !s.sports || s.sports.includes(sport))`.
`path_traps` has `sports: ['wc26']`, `bracket_impact` has `sports: ['wc26']`
→ `'soccer'` not in either list → both sources silently drop. WC games get
empty context from the journalism cron path.

Fix: secondary league-based promotion. If `sport === 'soccer'` AND
`game.league` contains WC signals, promote to `'wc26'`.

---

## PROBE BLOCK

1. Confirm `_SPORT_NORMALIZE` at ~L543 does NOT contain `'soccer'` → `'wc26'`.

2. Confirm the journalism cron call at L7821 uses:
   `sport: sportLabel` where `sportLabel = game.sport || 'unknown'` (L7780).

3. Confirm `assembleContext` body at L548-573:
   - `const _raw = String(game.sport || '').toLowerCase()`
   - `const sport = _SPORT_NORMALIZE[_raw] || _raw`
   - No secondary `game.league` check exists yet.

4. Live probe: `GET /journalism/context-probe?sport=soccer&league=FIFA%20World%20Cup`
   — should currently return EMPTY context for path_traps and bracket_impact.
   Confirm this by checking if `[TRAP CONTEXT]` appears for a WC game passed
   with sport='soccer'. This confirms the gap is real.

---

## TASK 1 — Secondary league-based sport promotion in `assembleContext`

In `src/context-assembler.js`, find:

```javascript
async function assembleContext(env, game, totalBudget = 1500) {
    if (!env || !game) return '';
    const _raw = String(game.sport || '').toLowerCase();
    const sport = _SPORT_NORMALIZE[_raw] || _raw;
    const applicable = CONTEXT_SOURCES.filter(s =>
        !s.sports || s.sports.includes(sport));
```

Replace with:

```javascript
async function assembleContext(env, game, totalBudget = 1500) {
    if (!env || !game) return '';
    const _raw = String(game.sport || '').toLowerCase();
    let sport = _SPORT_NORMALIZE[_raw] || _raw;
    // Secondary: promote 'soccer' → 'wc26' when league signals WC.
    // ESPN API returns game.sport='soccer' for all soccer including WC;
    // _SPORT_NORMALIZE only matches full 'fifa world cup' strings.
    // Without this, path_traps + bracket_impact (sports:['wc26']) drop silently.
    if (sport === 'soccer') {
        const _league = String(game.league || game.espnLeague || '').toLowerCase();
        if (/world.cup|fifa|wc26/i.test(_league)) sport = 'wc26';
    }
    const applicable = CONTEXT_SOURCES.filter(s =>
        !s.sports || s.sports.includes(sport));
```

**Verification:** 
- grep `context-assembler.js` for `world.cup|fifa|wc26` → must appear in
  the new secondary check.
- grep for `let sport =` (not `const`) — promotion requires `let`.

---

## TASK 2 — Live verification

After deploy, probe:
```
GET /journalism/context-probe?sport=soccer&league=FIFA+World+Cup+2026
```

If the fix is working, WC games passed with `sport='soccer'` and
`league='FIFA World Cup 2026'` must now show `[TRAP CONTEXT]` in context
(assuming today's path traps are populated). Check contextLength increased
vs a probe without the WC league.

Also confirm the existing working path still works:
```
GET /journalism/context-probe?sport=wc26
```
Should still show `[TRAP CONTEXT]` as before.

---

## TASK 3 — `node --check` + commit + deploy

```
node --check src/context-assembler.js
```

Commit:
```
fix: assembleContext sport-label mismatch — soccer→wc26 via league signal

Journalism cron passes game.sport='soccer' (ESPN API value) for WC games,
not 'wc26'. _SPORT_NORMALIZE had no 'soccer' entry. path_traps and
bracket_impact (sports:['wc26']) silently dropped for WC games in the
journalism cron path.

Fix: after _SPORT_NORMALIZE lookup, if sport='soccer' and game.league
contains world cup/fifa/wc26 signals, promote sport to 'wc26'. Secondary
check only — doesn't affect non-WC soccer (MLS, EPL etc.).
```

Push. Deploy.

---

## TASK 4 — Outbox manifest. Commit [skip ci] and push.

---

## DONE CONDITIONS

- [ ] `let sport =` (not const) in assembleContext
- [ ] Secondary `if (sport === 'soccer')` league check present
- [ ] `/world.cup|fifa|wc26/i` regex in the check
- [ ] `node --check src/context-assembler.js` passes
- [ ] Deploy green
- [ ] Live probe confirms [TRAP CONTEXT] for sport=soccer&league=FIFA+World+Cup
- [ ] Outbox manifest committed [skip ci]
