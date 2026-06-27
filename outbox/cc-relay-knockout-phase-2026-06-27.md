# WC26 Knockout Phase D1 Write Path — 2026-06-27

## Commit

- `1cad397` feat(wc): knockout phase D1 write path — extractWCPhase + r32/r16/qf/sf/final writes
- Deploy run: 28273805869 — conclusion: **success** at 2026-06-27T01:05:00Z
- `/deploy/verify` → `match: true, deployed: 1cad397` at 01:05:23Z

## Root cause fixed

`writeWCResult` had a hard `if (!groupId) return` gate — knockout rounds where
`extractWCGroup` returns null (non-group rounds) were silently dropped.
R32/R16/QF/SF/Final results would never reach D1 `wc_results`.

## Changes (src/index.js only)

### CHANGE 1 — `extractWCPhase()` function (inserted after `extractWCGroup`)

```js
function extractWCPhase(round) {
    if (!round) return null;
    const r = round.toLowerCase();
    if (/round\s+of\s+32|r32/.test(r))                           return 'r32';
    if (/round\s+of\s+16|r16/.test(r))                           return 'r16';
    if (/quarter/.test(r))                                        return 'qf';
    if (/semi/.test(r))                                           return 'sf';
    if (/third|3rd\s+place/.test(r))                             return 'third';
    if (/final/.test(r) && !/semi|quarter|third|3rd/.test(r))   return 'final';
    return null;
}
```

Handles ESPN strings: "Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Final".
BSD group_name knockout format TBD — regex broad enough to handle variants.

### CHANGE 2 — `writeWCResult` knockout path

- Old gate: `if (!groupId) return;` — hard drop for all knockout rounds
- New gate: `if (!groupId && !wcPhase) return;` — only drops truly unrecognized rounds
- Knockout branch: writes D1 with `group_id = wcPhase.toUpperCase()` (satisfies NOT NULL),
  `phase = wcPhase`. Then returns — standings recompute and journalism queue are group-stage only.
- Group-stage branch unchanged: `phase = 'group'` as before.

## Done conditions

- [x] `node --check src/index.js` clean
- [x] `grep -c "extractWCPhase" src/index.js → 2` (definition + call in writeWCResult)
- [x] `grep "if (!groupId && !wcPhase)" src/index.js` → found at L2087
- [x] `/health` → `RELAY OK` ✓
- [x] `/wc/results` → all existing entries have `phase: "group"` (no knockout results yet — first R32 June 28)
- [x] `/deploy/verify` → `match: true, deployed: 1cad397`, run 28273805869

## Activation

First knockout result: South Africa vs Canada, June 28 ~21:00Z.
When `writeWCResult` fires at `state=final`, ESPN will send `game.round = "Round of 32"`.
`extractWCPhase("Round of 32")` → `'r32'`.
D1 entry: `group_id='R32', phase='r32'`.
`/wc/results` will then include an entry with `phase='r32'`.

## Compliance

- **Rule 47**: Pure data write. No editorial computation.
- **Rule 69**: Only `src/index.js` touched. One commit.
- **Rule 77**: No rationalization. CI success confirmed before outbox written.
- **Rule 87**: Self-completing. All done-condition probes executed in-session.
