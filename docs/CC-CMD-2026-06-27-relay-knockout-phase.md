# CC-CMD-2026-06-27-relay-knockout-phase

**Date:** 2026-06-27  
**Scope:** Relay only — 1 file, 1 commit, 1 deploy  
**Deadline:** Before June 28 19:00Z (first R32 kickoff)  
**Rule 87:** Self-completing. Explicit done condition. No carry-forwards.

---

## Context

`writeWCResult` in the relay silently drops knockout-stage results because
`extractWCGroup()` returns null for non-group rounds and the function immediately
returns (`if (!groupId) return`). R32/R16/QF/SF/Final results will never reach D1.

**File:** `src/index.js` in `field-relay-nba`  
**File SHA at write time:** `7a4c0fa5664b02df7f6c6ebb75597854d65c7fcb` (verify at start)

---

## Setup

```bash
cd /tmp
git clone https://${FIELD_PAT}@github.com/jeffunglesbee-create/field-relay-nba.git relay
cd relay
# Verify SHA matches
git show HEAD:src/index.js | sha256sum
# Confirm targets exist
grep -n "extractWCGroup\|if (!groupId) return" src/index.js | head -10
```

---

## Change 1 — Add `extractWCPhase` after `extractWCGroup` (after L1809)

Find the exact end of `extractWCGroup` in `src/index.js`:

```javascript
    const g = _WC_TEAM_GROUP[norm(homeName)] || _WC_TEAM_GROUP[norm(awayName)];
    return g || null;
}
```

Immediately after that closing brace, insert:

```javascript
// Maps ESPN/BSD knockout round strings → phase values for D1 wc_results.phase.
// ESPN sends: "Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Final"
// BSD group_name for knockout: format TBD — regex is broad enough to handle variants.
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

---

## Change 2 — Extend `writeWCResult` (at L2070–2079)

Find this exact block in `writeWCResult`:

```javascript
    const groupId   = extractWCGroup(game.round, homeName, awayName);
    if (!groupId) return; // knockout stage or no round info — skip
    const matchDate = (game.start || '').slice(0, 10);
    const homeScore = game.home?.score ?? 0;
    const awayScore = game.away?.score ?? 0;
    await db.prepare(`
      INSERT OR IGNORE INTO wc_results
        (game_id, group_id, home, away, home_score, away_score, phase, match_date)
      VALUES (?, ?, ?, ?, ?, ?, 'group', ?)
    `).bind(game.id, groupId, homeName, awayName,
            homeScore, awayScore, matchDate).run();
```

Replace with:

```javascript
    const groupId   = extractWCGroup(game.round, homeName, awayName);
    const wcPhase   = extractWCPhase(game.round);
    if (!groupId && !wcPhase) return; // unrecognized round — skip
    const matchDate = (game.start || '').slice(0, 10);
    const homeScore = game.home?.score ?? 0;
    const awayScore = game.away?.score ?? 0;
    // Knockout path: write D1 result with phase string as group_id (satisfies NOT NULL),
    // then return. Standings recompute + journalism queue are group-stage only.
    // BSD captures handled by runBSDEndgameCapture cron; BracketDO recomputes on /wc/bracket fetch.
    if (!groupId) {
        const phaseUpper = wcPhase.toUpperCase();
        await db.prepare(`
          INSERT OR IGNORE INTO wc_results
            (game_id, group_id, home, away, home_score, away_score, phase, match_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(game.id, phaseUpper, homeName, awayName,
                homeScore, awayScore, wcPhase, matchDate).run();
        await db.prepare(
            'UPDATE wc_results SET home_score = ?, away_score = ? WHERE game_id = ?'
        ).bind(homeScore, awayScore, game.id).run();
        return;
    }
    await db.prepare(`
      INSERT OR IGNORE INTO wc_results
        (game_id, group_id, home, away, home_score, away_score, phase, match_date)
      VALUES (?, ?, ?, ?, ?, ?, 'group', ?)
    `).bind(game.id, groupId, homeName, awayName,
            homeScore, awayScore, matchDate).run();
```

---

## Verify + Commit

```bash
# Confirm both strings are present
grep -c "extractWCPhase" src/index.js   # expect ≥ 2 (definition + call)
grep -n "wcPhase\|if (!groupId && !wcPhase)" src/index.js | head -5

# No wrangler build needed — relay deploys on push via CF Pages CI
git add src/index.js
git commit -m "feat(wc): knockout phase D1 write path — extractWCPhase + r32/r16/qf/sf/final writes"
git push origin main
```

---

## Probe Block (run after ~3 min deploy)

```bash
# 1. Relay health
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') or d.get('status')=='ok' else d)"

# 2. Existing D1 results count unchanged (group stage not broken)
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/wc/results \
  | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('results',[]); print(f'results: {len(r)}, all group: {all(x[\"phase\"]==\"group\" for x in r)}')"
# expect: results ≥ 56, all group: True (no knockout results yet — none have been played)

# 3. Confirm deployed commit contains extractWCPhase
DEPLOYED_SHA=$(curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('git_sha','unknown'))")
echo "Deployed SHA: $DEPLOYED_SHA"
```

---

## Done Condition

✅ `grep -c "extractWCPhase" src/index.js` returns ≥ 2 in committed code  
✅ `grep "if (!groupId && !wcPhase)" src/index.js` finds the new guard  
✅ Relay health returns ok after deploy  
✅ Existing D1 result count unchanged (≥ 56, all phase='group')  

When the first knockout result lands (South Africa vs Canada, June 28 ~21:00Z final),
`/wc/results` will contain an entry with `phase='r32'` and `group_id='R32'`.
No manual verification needed before then — the function fires on ESPN `state=final`.
