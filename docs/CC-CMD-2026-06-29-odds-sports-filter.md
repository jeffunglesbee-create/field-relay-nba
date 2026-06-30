# CC-CMD — Odds API: Add AFL + CFL to buildOddsStoryContext Sports Filter

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Add 'afl' and 'cfl' to odds_story CONTEXT_SOURCE sports array
**Why:** AFL and CFL odds are captured in ARCHIVE_DB (ARCHIVE_SPORT_TO_ODDS_KEY
         has both: afl → aussierules_afl, cfl → americanfootball_cfl).
         But buildOddsStoryContext never fires for AFL or CFL games because
         their sport keys are absent from the sports filter.
         AFL Round 17 starts July 2 — fix before then.
**Target time:** 10 min

---

## CONFIDENCE GATE

Do not commit unless confidence ≥ 95.

---

## PROBE BLOCK

```bash
git log -1 --oneline
basename $(git remote get-url origin)
# Expected: field-relay-nba

# Confirm current sports filter
grep -n "odds_story\|aussierules_afl\|americanfootball_cfl" src/context-assembler.js | head -5
grep -n "ARCHIVE_SPORT_TO_ODDS_KEY\|afl.*odds\|cfl.*odds" src/index.js | head -5
# Confirm AFL + CFL are in ARCHIVE_SPORT_TO_ODDS_KEY
sed -n '5280,5296p' src/index.js
```

---

## THE CHANGE

In `src/context-assembler.js`, find (L841-843):

```javascript
{ id: 'odds_story',   priority: 5, budget: 100, builder: buildOddsStoryContext,
  sports: ['mlb', 'nba', 'nhl', 'nfl', 'wnba', 'epl', 'mls',
           'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1'] },
```

Replace with:

```javascript
{ id: 'odds_story',   priority: 5, budget: 100, builder: buildOddsStoryContext,
  sports: ['mlb', 'nba', 'nhl', 'nfl', 'wnba', 'epl', 'mls',
           'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1',
           'afl', 'cfl'] },
```

---

## VERIFY

```bash
node --check src/context-assembler.js
grep -n "'afl'" src/context-assembler.js
grep -n "'cfl'" src/context-assembler.js
# Expected: 1 hit each inside odds_story sports array
```

---

## COMMIT + DEPLOY

```bash
git add src/context-assembler.js
git commit -m "feat(odds): add afl + cfl to odds_story CONTEXT_SOURCE sports filter"
git push origin main  # 2 attempts max
```

Wait ~60s then verify:
```bash
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/deploy/verify
```

---

## CONFIDENCE SCORING

| Factor | Points | Check |
|--------|--------|-------|
| 'afl' in odds_story sports array | 30 | grep: 1 hit in context-assembler.js |
| 'cfl' in odds_story sports array | 30 | grep: 1 hit in context-assembler.js |
| node --check passes | 25 | exit 0 |
| Deploy matches HEAD | 15 | match: true |

Score < 95: do not push.

---

## OUTBOX MANIFEST

| Item | Status |
|------|--------|
| Probe: read current sports array | ⏳ |
| Add 'afl' and 'cfl' to array | ⏳ |
| node --check passes | ⏳ |
| grep confirms both additions | ⏳ |
| Commit + push (2 attempts max) | ⏳ |
| deploy/verify match: true | ⏳ |

---

**Session: 2026-06-29 · RELAY ONLY · 10 min · Confidence gate: 95**
