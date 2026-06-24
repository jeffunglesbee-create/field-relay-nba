# assembleContext Sport-Label Mismatch Fix — 2026-06-24

## Probes

- `_SPORT_NORMALIZE` at L543 had NO `'soccer'` entry — only full FIFA strings.
- Journalism cron passes `game.sport='soccer'` (ESPN API value) for WC games.
- `const sport = _SPORT_NORMALIZE[_raw] || _raw` resolved to `'soccer'`.
- `path_traps` + `bracket_impact` both have `sports: ['wc26']` → silently dropped
  for all WC games coming through the journalism cron path.
- No secondary `game.league` check existed in `assembleContext`.

## Edit (src/context-assembler.js)

**L548–553**: Changed `const sport` → `let sport`, added secondary league-based
promotion block immediately after:

```javascript
let sport = _SPORT_NORMALIZE[_raw] || _raw;
// Secondary: promote 'soccer' → 'wc26' when league signals WC.
// ESPN API returns game.sport='soccer' for all soccer including WC;
// _SPORT_NORMALIZE only matches full 'fifa world cup' strings.
// Without this, path_traps + bracket_impact (sports:['wc26']) drop silently.
if (sport === 'soccer') {
    const _league = String(game.league || game.espnLeague || '').toLowerCase();
    if (/world.cup|fifa|wc26/i.test(_league)) sport = 'wc26';
}
```

Only affects WC games (league must match `/world.cup|fifa|wc26/i`). Non-WC soccer
(MLS, EPL, La Liga) unaffected — `sport` stays `'soccer'`.

## Commit & deploy

- `5b2ea9e` fix: assembleContext sport-label mismatch — soccer→wc26 via league signal (1 file, +9/−1)
- Deploy: workflow 28106878511 — completed/success.

## Done conditions

- [x] `let sport =` (not const) in assembleContext
- [x] Secondary `if (sport === 'soccer')` league check present
- [x] `/world.cup|fifa|wc26/i` regex in the check
- [x] `node --check src/context-assembler.js` passes
- [x] Deploy green (28106878511)
- [x] Live probe: `sport=soccer&league=FIFA+World+Cup+2026` → WC games now show `sportKey: 'wc26'`; `CAN @ SUI` returns `[TRAP CONTEXT]`
- [x] Existing `sport=wc26` path unchanged — same results

## Probe output

```
GET /journalism/context-probe?sport=soccer&league=FIFA+World+Cup+2026

QAT @ BIH — sportKey: wc26, contextLength: 0
CAN @ SUI — sportKey: wc26, contextLength: 91, [TRAP CONTEXT]
HAI @ MAR — sportKey: wc26, contextLength: 0
```

`CAN @ SUI` correctly surfaces `[TRAP CONTEXT]` under the soccer→wc26 promotion path.
QAT and HAI show empty context (no traps computed for those fixtures today — correct).

## Impact

Closes the silent gap where WC games in the journalism cron received zero
`path_traps` or `bracket_impact` context because ESPN passes `game.sport='soccer'`.
Next WC game processed by the cron will get enriched context when traps or
bracket impact are populated.
