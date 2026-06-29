# CC-CMD — Kali _kaliProof Field in buildAFLJournalismContext

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Add _kaliProof to injected journalism.kali object
**Why:** Without this field, Phase 3 can only verify Kali indirectly. The
         render pipeline strips game.journalism in some paths. _kaliProof
         lets Phase 3 read game.journalism.kali._kaliProof.adapterId from
         allData and confirm definitively that Kali data reached the browser.
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

# Find buildAFLJournalismContext and the kali assignment block
grep -n "buildAFLJournalismContext\|ctx\[g.espnEventId\].kali\s*=" src/index.js | head -10

# Read the kali assignment (L3301 area)
sed -n '3295,3315p' src/index.js
```

---

## THE CHANGE

Find this block in `buildAFLJournalismContext` (around L3301):

```javascript
ctx[g.espnEventId].kali = {
    homeWinPct:        pred.homeProbability,
    awayWinPct:        pred.awayProbability,
    squiggleConsensus: pred.squiggleConsensus,
    factors:           pred.factors || [],
    homeBreakdown:     pred.homeBreakdown || {},
    awayBreakdown:     pred.awayBreakdown || {},
};
```

Add `_kaliProof` as the last field:

```javascript
ctx[g.espnEventId].kali = {
    homeWinPct:        pred.homeProbability,
    awayWinPct:        pred.awayProbability,
    squiggleConsensus: pred.squiggleConsensus,
    factors:           pred.factors || [],
    homeBreakdown:     pred.homeBreakdown || {},
    awayBreakdown:     pred.awayBreakdown || {},
    _kaliProof: {
        adapterId: 'kali-afl',
        sourceId:  'kali-aflstats',
        round:     round,
        year:      year,
    },
};
```

---

## VERIFY

```bash
node --check src/index.js
grep -n "_kaliProof" src/index.js
# Expected: 1 hit inside buildAFLJournalismContext
```

---

## COMMIT

```bash
git add src/index.js
git commit -m "feat(kali): add _kaliProof to journalism.kali for adapter proof observability"
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
| `_kaliProof` field added at correct location | 30 | Inside kali assignment, not elsewhere |
| Contains adapterId, sourceId, round, year | 30 | grep confirms all 4 fields |
| `node --check` passes | 25 | exit 0 |
| Deploy matches HEAD | 15 | deploy/verify match: true |

Score < 95: do not push. Report which check failed.

---

## OUTBOX MANIFEST

| Item | Status |
|------|--------|
| Read buildAFLJournalismContext source | ⏳ |
| Add _kaliProof to kali assignment | ⏳ |
| node --check passes | ⏳ |
| grep confirms 4 fields | ⏳ |
| Commit + push (2 attempts max) | ⏳ |
| deploy/verify match: true | ⏳ |

---

**Session: 2026-06-29 · RELAY ONLY · 10 min · Confidence gate: 95**
