# CC-CMD — WC26 Knockout Phase D1 Write Path

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Add extractWCPhase + extend writeWCResult — R32/R16/QF/SF write to D1
**Original CC-CMD:** CC-CMD-2026-06-27-relay-knockout-phase.md (written pre-R32, never executed)
**Urgency:** Germany vs Paraguay kicks off ~20:30 UTC today. Without this fix,
             knockout results silently drop from D1 — BSD history context and
             journalism briefs lose knockout match data permanently.
**Target time:** 15 min

---

## DONE CONDITION

```sql
SELECT phase, COUNT(*) FROM wc_results GROUP BY phase
```
Shows `r32` rows for South Africa vs Canada + Brazil vs Japan (already finished).
Future R32 games write with `phase='r32'` on game-final.

---

## PROBE BLOCK

```bash
git log -1 --oneline
basename $(git remote get-url origin)
# Expected: field-relay-nba

# Verify targets exist
grep -n "extractWCGroup\|if (!groupId) return\|extractWCPhase" src/index.js | head -10

# Confirm wc_results has no r32 rows yet
# (checked via CF D1 MCP — 10 rows all phase='group')
```

---

## CHANGE 1: Add extractWCPhase after extractWCGroup

Find the closing brace of `extractWCGroup`. Insert immediately after:

```javascript
// Maps ESPN knockout round strings → phase values for D1 wc_results.phase.
// ESPN sends: "Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Final"
function extractWCPhase(round) {
    if (!round) return null;
    const r = round.toLowerCase();
    if (/round\s+of\s+32|r32/.test(r))                          return 'r32';
    if (/round\s+of\s+16|r16/.test(r))                          return 'r16';
    if (/quarter/.test(r))                                       return 'qf';
    if (/semi/.test(r))                                          return 'sf';
    if (/third|3rd\s+place/.test(r))                            return 'third';
    if (/final/.test(r) && !/semi|quarter|third|3rd/.test(r))  return 'final';
    return null;
}
```

---

## CHANGE 2: Extend writeWCResult

Find the block:
```javascript
    const groupId = extractWCGroup(game.round, homeName, awayName);
    if (!groupId) return; // knockout stage or no round info — skip
```

Replace with:
```javascript
    const groupId = extractWCGroup(game.round, homeName, awayName);
    const wcPhase = extractWCPhase(game.round);
    if (!groupId && !wcPhase) return; // unrecognized round — skip
    const effectiveGroupId = groupId || wcPhase.toUpperCase();
    const effectivePhase   = groupId ? 'group' : wcPhase;
```

Then replace `groupId` and `'group'` literals in the INSERT bind:
```javascript
    ).bind(game.id, effectiveGroupId, homeName, awayName,
           homeScore, awayScore, effectivePhase, matchDate).run();
```

---

## CHANGE 3: Backfill South Africa vs Canada and Brazil vs Japan

Both games are finished and have `bsd_event_id` set but `phase='group'`. Correct them:

Add a one-time admin endpoint OR update directly via the CF D1 MCP after deploy:

```sql
UPDATE wc_results SET phase='r32', group_id='R32'
WHERE game_id IN (
  SELECT game_id FROM wc_results
  WHERE (home='South Africa' AND away='Canada')
     OR (home='Brazil' AND away='Japan')
)
```

---

## COMMIT + DEPLOY

```bash
node --check src/index.js
git add src/index.js
git commit -m "feat(wc): extractWCPhase — R32/R16/QF/SF/F write path to wc_results D1"
git push origin main
```

Wait ~60s then verify deploy/verify matches.

---

## CONFIDENCE GATE: 95

| Factor | Points |
|--------|--------|
| extractWCPhase defined in source | 20 |
| writeWCResult uses effectiveGroupId/Phase | 25 |
| node --check passes | 20 |
| Deploy matches HEAD | 20 |
| D1 backfill applied (Canada + Brazil rows = r32) | 15 |

**Session: 2026-06-29 · RELAY ONLY · 15 min**
