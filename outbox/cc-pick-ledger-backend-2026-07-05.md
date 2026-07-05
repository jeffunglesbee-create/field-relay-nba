# Pick 'em Backend — Cumulative Non-Resetting Ledger — 2026-07-05

## Commits

- `fb90555` ci: fix score-fill cron to fire 10 min before drama-backfill at 4h marks
- `befd20e` feat(user-do): add pickLedger — permanent cumulative pick 'em record

## What Changed

**`.github/workflows/score-fill.yml`** — cron fixed from `0 */4 * * *` (raced
drama-backfill at shared 4h marks) to `50 3,7,11,15,19,23 * * *` (fires
10 minutes before drama-backfill at 04:00, 08:00, 12:00, 16:00, 20:00, 00:00 UTC).

**`src/user-do.js`** — four changes:

1. **Header comment** updated: added `pickLedger` to STORED STATE section, added
   `pick_made`/`pick_resolved` to event types list, added `pickLedger: PERMANENT`
   to TTL/RETENTION section.

2. **`_handleInit`** — seeds `pickLedger` for new users:
   ```javascript
   await this.state.storage.put('pickLedger', { picks: [], totalMade: 0, totalCorrect: 0 });
   ```
   Deliberately no TTL — unlike watchHistory (30d rolling) and dramaticMomentsMissed
   (7d). Existing users get `|| { picks: [], totalMade: 0, totalCorrect: 0 }` fallback.

3. **`_handleState`** — reads `pickLedger`, computes `accuracyRate`, returns:
   ```json
   "picks": { "totalMade": N, "totalCorrect": M, "accuracyRate": null | 0.000 }
   ```
   `accuracyRate` is `null` when `totalMade === 0` (avoids division-by-zero).
   No streak, no consecutive-day, no current-run field anywhere.

4. **`_handleEvent`** — two new event types:
   - `pick_made { gameId, sport, predictedWinner }` → appends to `picks[]`,
     increments `totalMade`. Permanent append, no pruning.
   - `pick_resolved { gameId, wasCorrect, revealedProbability, probabilitySource }` →
     finds matching unresolved pick by `gameId`, marks `resolved: true`,
     stores `wasCorrect`, `revealedProbability`, `probabilitySource` on the pick
     itself (for source-specific display labeling at reveal time — never a bare
     "win probability"). Increments `totalCorrect` only if `wasCorrect`. Returns
     404 if pick not found or already resolved.

## Design Decisions

**No streak, no consecutive-day tracking** — Rule 33's gamification audit explicitly
left streak mechanics unresolved. This design resolves it by removing the
resettable-chain mechanism entirely, not by renaming it. Cumulative volume/accuracy
milestones (e.g. "100 picks", "62% lifetime accuracy") are the only signals tracked.

**`probabilitySource` per resolved pick** — stores "poisson", "market", etc. to
allow the display layer to apply "Statistical probability" vs "Market estimate" labels
correctly. This CC-CMD does not build that display logic — only stores what it needs.

**Permanent field** — `pickLedger` is never pruned, not subject to any TTL filter.
This is a deliberate deviation from `watchHistory` and `dramaticMomentsMissed`.

## Live Verification (2026-07-05, deploy befd20e, 17:50Z)

Full init → pick_made × 2 → pick_resolved × 2 → state check sequence run against
a real UserDO instance (`pick-test-verify-01`):

```json
{
  "init":    { "ok": true, "created": true },
  "pick1":   { "ok": true, "totalMade": 1 },
  "pick2":   { "ok": true, "totalMade": 2 },
  "resolve1": { "ok": true, "totalCorrect": 1 },
  "resolve2": { "ok": true, "totalCorrect": 1 },
  "state": {
    "ok": true,
    "picks": { "totalMade": 2, "totalCorrect": 1, "accuracyRate": 0.5 },
    "watchHistory": [], "seriesLedger": {}, "dramaticMomentsMissed": []
  }
}
```

- 2 picks made, 1 correct (game001/Lakers), 1 wrong (game002/Warriors) → accuracyRate 0.5 ✓
- resolve2 (wasCorrect: false) did not increment totalCorrect ✓
- No streak/consecutive field anywhere in state response ✓
- revealedProbability (0.62 / 0.41) and probabilitySource ("poisson" / "market")
  stored on resolved picks in storage — not surfaced in state summary (correct; they
  live on individual pick objects for per-pick reveal, not aggregate stats) ✓

## Confidence Score

+25  pickLedger correctly permanent/non-purging — no TTL filter added anywhere
+30  Both event types correct, no streak logic anywhere in code or response
+20  /user/state exposes cumulative-only stats (totalMade, totalCorrect, accuracyRate)
+25  Real live test sequence verified against actual UserDO instance
= **100/100**

## Compliance

- Rule 68: probe block run before edits; live endpoint tested post-deploy
- Rule 87: self-completing — algorithm verified, real deploy executed, live sequence passed
- Rule 33: gamification question resolved by removing the resettable-chain mechanism
  entirely — no consecutive-day field added anywhere
