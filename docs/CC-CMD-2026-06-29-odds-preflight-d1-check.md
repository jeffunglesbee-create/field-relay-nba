# CC-CMD — Odds API D1 Preflight: Opening + Closing Odds Populated

**Date:** 2026-06-29
**Repo:** field-relay-nba (READ ONLY — no code changes)
**Scope:** Verify opening_odds + closing_odds populated in D1 before running Phase 3
**Why:** At Phase 1 probe time, D1 had zero opening_odds for today's MLB games.
         snapshotCronOdds fires at game start. AmbientDO._captureClosingOdds()
         fires at pre→live transition. Both should now have run.
         Phase 3 cannot verify [ODDS STORY] without at least one row with BOTH.
**Run before:** CC-CMD-2026-06-29-odds-adapter-proof-p3.md
**Target time:** 5 min

---

## CONFIDENCE GATE

Do not proceed to Phase 3 unless this check passes.
If opening_odds still empty: wait 15 min and retry (max 3 retries).

---

## DONE CONDITION

/odds-story/preview?date=2026-06-29 returns ≥1 game with:
- opening_odds present
- closing_odds present (at least one game that went live)
- materialized [ODDS STORY] output visible

---

## STEP 1: Probe /odds-story/preview

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/odds-story/preview?date=2026-06-28" | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'total: {d.get(\"total\")}')
print(f'withStory: {d.get(\"withStory\")}')
print(f'withoutStory: {d.get(\"withoutStory\")}')
print(f'missingOpening: {d.get(\"missingOpening\")}')
print(f'missingClosing: {d.get(\"missingClosing\")}')
print()
for game in (d.get('games') or [])[:5]:
    print(f'{game.get(\"home\")} vs {game.get(\"away\")}')
    print(f'  opening: {\"yes\" if game.get(\"opening_odds\") else \"NO\"}')
    print(f'  closing: {\"yes\" if game.get(\"closing_odds\") else \"NO\"}')
    print(f'  story: {game.get(\"story\") or \"(none)\"}')
"
```

**Expected (games now live):**
```
total: 13
withStory: 2+
missingOpening: 0
missingClosing: 8+   ← still closing, OK
```

---

## STEP 2: Scoring

| Check | Pass condition | Points |
|-------|---------------|--------|
| opening_odds populated for ≥1 MLB game today | missingOpening < total | 50 |
| closing_odds populated for ≥1 MLB game today | missingClosing < total | 30 |
| [ODDS STORY] materializes for ≥1 game | withStory ≥ 1 | 20 |

**Score 100/100:** proceed to Phase 3 immediately.
**Score 80/100 (opening yes, closing no):** wait 15 min, retry Step 1.
  Games need to go live before closing_odds writes. Normal.
**Score 50/100 (opening no):** snapshotCronOdds hasn't run yet.
  Wait 15 min max 3 retries. If still 50 after 3 retries — do not
  proceed. Report to chat session for manual cron trigger.
**Score 0:** probe returned error. Check relay deploy status.

---

## OUTBOX MANIFEST

| Item | Status |
|------|--------|
| /odds-story/preview?date=2026-06-29 probed | ⏳ |
| opening_odds ≥1 game confirmed | ⏳ |
| closing_odds ≥1 game confirmed (or retry noted) | ⏳ |
| Score calculated | ⏳ |
| Gate: proceed to Phase 3 OR wait OR escalate | ⏳ |

---

**Session: 2026-06-29 · RELAY READ ONLY · 5 min · Gates Phase 3**
