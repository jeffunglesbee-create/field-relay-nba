# CC-CMD — Odds API: Add _oddsProof to extractOddsForGame

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Add _oddsProof to extractOddsForGame() return object
**Why:** Without this field, Phase 3 can only prove odds via /odds-story/preview
         endpoint. With it, D1 opening_odds JSON contains proof that the
         Odds API adapter wrote the row — same pattern as _kaliProof.
         Applies to all future D1 rows written by snapshotCronOdds.
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

# Find extractOddsForGame return object
grep -n "extractOddsForGame\|function extractOddsForGame" src/index.js | head -5
# Read the function — confirm return object shape
sed -n '5313,5342p' src/index.js
```

---

## THE CHANGE

Find the return object in `extractOddsForGame` (L5323 area):

```javascript
const out = { source: bk.key, captured_at: new Date().toISOString() };
```

Replace with:

```javascript
const out = {
  source:      bk.key,
  captured_at: new Date().toISOString(),
  _oddsProof:  { adapterId: 'odds-api', sourceId: 'odds-api-the-odds-api' },
};
```

No other changes. The `_oddsProof` field is stored inside the `opening_odds`
JSON in D1. When queried via `/odds-story/preview` or direct D1 query,
the proof field is visible without any additional relay routes.

---

## VERIFY

```bash
node --check src/index.js
grep -n "_oddsProof" src/index.js
# Expected: 1 hit inside extractOddsForGame
```

---

## COMMIT + DEPLOY

```bash
git add src/index.js
git commit -m "feat(odds): add _oddsProof to extractOddsForGame — proof observability in D1 opening_odds"
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
| `_oddsProof` inside extractOddsForGame return (not elsewhere) | 35 | grep: 1 hit |
| Contains adapterId + sourceId | 35 | grep confirms both strings |
| `node --check` passes | 20 | exit 0 |
| Deploy matches HEAD | 10 | match: true |

Score < 95: do not push.

---

## OUTBOX MANIFEST

| Item | Status |
|------|--------|
| Read extractOddsForGame (probe block) | ⏳ |
| Add _oddsProof to return object | ⏳ |
| node --check passes | ⏳ |
| grep: 1 hit in src/index.js | ⏳ |
| Commit + push (2 attempts max) | ⏳ |
| deploy/verify match: true | ⏳ |

---

**Session: 2026-06-29 · RELAY ONLY · 10 min · Confidence gate: 95**
