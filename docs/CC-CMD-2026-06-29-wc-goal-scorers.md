# CC-CMD — WC26 Goal Scorers in Post-Match Briefs

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Thread ESPN comp.details through adapter → writeWCResult
**Why:** writeWCResult calls API-Sports /fixtures/events with an ESPN ID
         (espn:760487) which returns 400 silently. Goal scorer data (player
         names, minutes, cards) is dropped from post-match journalism briefs.
**Target time:** 15 min

---

## DONE CONDITION

`/v2/games?sport=wc26` for a final game includes `matchEvents` array with
at least one entry showing player name + minute.

---

## PROBE BLOCK

```bash
# Find where comp.details is accessible in the ESPN WC adapter
grep -n "comp\.details\|matchEvents\|eventsContext\|goal.*scorer\|adaptESPN.*WC\|adaptESPNWC" src/index.js | head -20

# Find writeWCResult and the API-Sports call it makes
grep -n "writeWCResult\|fixtures\/events\|eventsContext\|numericId" src/index.js | head -15
```

---

## CHANGE 1: Extract comp.details in ESPN WC adapter

Find where game objects are built from ESPN competitions. After building the
game object (home, away, score, state etc.), add:

```javascript
// Thread match events for writeWCResult — avoids defunct API-Sports call
game.matchEvents = (comp.details || [])
    .filter(d => d.type?.id)
    .map(d => ({
        type:    d.type?.text || d.type?.id,
        minute:  d.clock?.displayValue || null,
        team:    d.team?.displayName || null,
        players: (d.athletesInvolved || []).map(a => a.displayName),
        redCard: d.redCard || false,
        yellowCard: d.yellowCard || false,
        scoringPlay: d.scoringPlay || false,
    }));
```

---

## CHANGE 2: Use matchEvents in writeWCResult instead of API-Sports

Find the block in writeWCResult that:
```javascript
const numericId = String(game.id).replace('football:', '');
// calls /fixtures/events?fixture=...
```

Replace the API-Sports call with:
```javascript
// Use ESPN match events threaded from adapter — API-Sports call was using ESPN
// IDs which return 400 (espn:760487 is not a valid API-Sports fixture ID)
const eventsContext = Array.isArray(game.matchEvents) && game.matchEvents.length > 0
    ? game.matchEvents
    : null;
```

Then use `eventsContext` where the API-Sports response was previously consumed.

---

## COMMIT

```bash
node --check src/index.js
git add src/index.js
git commit -m "fix(wc): thread ESPN comp.details as matchEvents — replaces silent API-Sports 400"
git push origin main
```

**Session: 2026-06-29 · RELAY ONLY · 15 min**
