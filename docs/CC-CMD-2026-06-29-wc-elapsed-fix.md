# CC-CMD — WC26 Live Win Probability elapsed=0 Fix

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Thread BSD current_minute into situation.elapsed in handleV2Games
**Why:** computeLiveWP uses elapsedMin=0 for all live WC games — treats every
         game as if it's at kickoff. A 2-1 game at 78' computes wrong WP.
**Target time:** 10 min

---

## DONE CONDITION
**CONFIDENCE GATE: Do not commit unless score ≥ 95. Report score verbatim if below threshold.**


`/v2/games?sport=wc26` for a live game shows:
```json
{ "situation": { "elapsed": 67, ... } }
```
Not `elapsed: 0` or `situation: null`.

---

## PROBE BLOCK

```bash
grep -n "bsdEventId\|current_minute\|situation.*elapsed\|_bsdMatch" src/index.js | head -20
# Find the bsdEventId injection block (L3465-3478)
# Find where situation is built on game objects
```

---

## THE CHANGE

In the BSD enrichment block (around L3475), after:
```javascript
if (_bsdMatch) _g.bsdEventId = String(_bsdMatch.id);
```

Add:
```javascript
if (_bsdMatch && _bsdMatch.current_minute != null) {
    if (!_g.situation) _g.situation = {};
    _g.situation.elapsed = _bsdMatch.current_minute;
}
```

This adds `elapsed` to the situation object for any game that matched BSD's live pool.
If situation is null (pregame), it creates a minimal object with elapsed only.
computeLiveWP reads `sit.elapsed || 0` — this overrides the 0 with real minute.

---

## COMMIT

```bash
node --check src/index.js
git add src/index.js
git commit -m "fix(wc): thread BSD current_minute into situation.elapsed for live WP accuracy"
git push origin main
```

**Session: 2026-06-29 · RELAY ONLY · 10 min**
