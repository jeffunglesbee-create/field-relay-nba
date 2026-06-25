# CC-CMD: Golf `_derived` SG Proxy — `handleESPNGolfScoreboard`
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Rule 87:** Self-completing.
**File:** `src/index.js`

---

## WHAT THIS DOES

Attaches `stats._derived` to every player in the `leaderboard` array returned
by `handleESPNGolfScoreboard`. Computes field-relative SG proxies using
Broadie methodology against dynamic field averages derived from the leaderboard
itself. No external data source, no API key, no new dependencies.

Client already consumes `_derived` at L15566–15580 of index.html:
- `sgPuttingEst`   → rendered as "est. +2.0 SG putting/rd" (threshold ±0.3)
- `sgApproachEst`  → rendered as "est. +1.6 SG approach/rd" (threshold ±0.2)
- `ballStriking`   → rendered as "ball-striking 83 (elite)"
- `narrative`      → rendered as free-text line in FIELD est. block

---

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba && git pull

# 1. Confirm insertion anchor exists exactly once
grep -c "Top-level round: prefer current-round derived" src/index.js
# Expected: 1

# 2. Confirm _derived not yet present
grep -c '_derived' src/index.js
# Expected: 0

# 3. Confirm client already reads _derived (cross-ref only — do not modify)
grep -n '_derived' /home/claude/jubilant-bassoon/index.html 2>/dev/null | head -10
# Expected: L15566-15580 references sgPuttingEst, sgApproachEst, ballStriking, momentum, narrative

# 4. Verify live enriched endpoint — confirm leaderboard has stats fields
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched | \
  python3 -c "
import json,sys
d=json.load(sys.stdin)
lb=d.get('leaderboard',[])
with_stats=[p for p in lb if p.get('stats',{}).get('gir',0)>0]
print(f'Total players: {len(lb)}')
print(f'Players with complete stats: {len(with_stats)}')
if with_stats:
    s=with_stats[0]['stats']
    print(f'Sample stats fields: {list(s.keys())}')
    print(f'Leader: {lb[0][\"name\"]} {lb[0][\"toPar\"]} thru {lb[0][\"thru\"]}')
"
# Expected: total=72, with_stats>=5, fields include gir/drivingDistance/drivingAccuracy/puttsPerGir
```

---

## TASK — Insert `_attachDerived` IIFE after `leaderboard` array is built

**Location:** After L2337 (`});` — end of `leaderboard` map), before L2338
(`// Top-level round: prefer current-round derived...`)

**Anchor for str_replace:**
```
    // Top-level round: prefer current-round derived from the first competitor's
    // linescores during live play. Falls back to ev.status.period (set during
    // off-play windows when ESPN populates it) then the short detail string.
    const topRound = currentRoundFromLinescores(entries[0]?.linescores)
```

**Replace with (prepend the IIFE block before the comment):**
```javascript
    // ── FIELD Analytics Engine: field-relative SG proxies ────────────────────
    // Attaches stats._derived to each leaderboard player using Broadie
    // methodology applied to the leaderboard field as baseline.
    // Consumed by buildGolfPromptContext at L15566–15580 (jubilant-bassoon).
    // Field averages update dynamically — partial-field R1 averages are still
    // meaningful as long as ≥5 players have complete stat data.
    (function _attachDerived() {
        const withStats = leaderboard.filter(p =>
            p.stats?.gir > 0 &&
            p.stats?.puttsPerGir > 0 &&
            p.stats?.drivingDistance > 0 &&
            p.stats?.drivingAccuracy > 0
        );
        if (withStats.length < 5) return; // insufficient baseline

        const mean = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0) / arr.length;
        const fieldGir   = mean(withStats, p => p.stats.gir);
        const fieldPutts = mean(withStats, p => p.stats.puttsPerGir);
        const fieldDist  = mean(withStats, p => p.stats.drivingDistance);
        const fieldAcc   = mean(withStats, p => p.stats.drivingAccuracy);

        for (const p of leaderboard) {
            const s = p.stats;
            if (!s?.gir || !s?.puttsPerGir || !s?.drivingDistance) continue;

            const holes   = (typeof p.thru === 'number' && p.thru > 0) ? p.thru : 18;
            const girsHit = Math.round(s.gir / 100 * holes);
            if (girsHit < 1) continue;

            // SG:Putting proxy — lower putts/GIR than field = strokes gained
            const sgPuttingEst = +( -(s.puttsPerGir - fieldPutts) * girsHit ).toFixed(2);

            // SG:Approach proxy — GIR% delta × holes played
            const sgApproachEst = +( (s.gir - fieldGir) / 100 * holes ).toFixed(2);

            // SG:OTT proxy — distance + accuracy delta vs field
            const sgOttEst = +(
                (s.drivingDistance - fieldDist) * 0.008 +
                (s.drivingAccuracy - fieldAcc)  * 0.025
            ).toFixed(2);

            // ballStriking: 0–100 composite. 50=field avg, 75=elite, <40=struggling.
            const ballStriking = Math.max(20, Math.min(100, Math.round(
                50 + (s.gir - fieldGir) * 1.5 + (s.drivingAccuracy - fieldAcc) * 0.5
            )));

            // Narrative: strongest detectable signal only. null = no notable pattern.
            const name = p.name || '';
            let narrative = null;
            if      (sgApproachEst >= 1.5 && sgPuttingEst >=  0.8)
                narrative = `${name} is earning every stroke — elite approach game and putting`;
            else if (sgApproachEst >= 1.0 && sgPuttingEst <= -0.5)
                narrative = `${name} is striping it but leaving shots on the greens`;
            else if (sgApproachEst <= -0.8 && sgPuttingEst >= 1.2)
                narrative = `${name}'s putter is carrying them — approach game below field average`;
            else if (sgApproachEst <= -1.0 && sgPuttingEst <= -0.5)
                narrative = `${name} is grinding — both approach and putting below the field today`;
            else if (sgOttEst >= 0.8 && sgApproachEst >= 0.5)
                narrative = `${name} is hitting it long and accurate, creating easy scoring positions`;

            s._derived = {
                sgPuttingEst,
                sgApproachEst,
                sgOttEst,
                ballStriking,
                narrative,
                fieldAvg: {
                    gir:             +fieldGir.toFixed(1),
                    puttsPerGir:     +fieldPutts.toFixed(3),
                    drivingDistance: +fieldDist.toFixed(1),
                    drivingAccuracy: +fieldAcc.toFixed(1),
                    n:               withStats.length,
                },
            };
        }
    })();

    // Top-level round: prefer current-round derived from the first competitor's
    // linescores during live play. Falls back to ev.status.period (set during
    // off-play windows when ESPN populates it) then the short detail string.
    const topRound = currentRoundFromLinescores(entries[0]?.linescores)
```

---

## DONE CONDITIONS

```bash
# 1. _derived added to source
grep -c '_derived' src/index.js
# Expected: ≥ 8 (multiple references inside the IIFE)

# 2. _attachDerived IIFE present
grep -c '_attachDerived' src/index.js
# Expected: 1

# 3. Smoke passes
node smoke.js 2>&1 | tail -3
# Expected: N passed, 0 failed

# 4. Verify live output has _derived populated
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched | \
  python3 -c "
import json,sys
d=json.load(sys.stdin)
lb=d.get('leaderboard',[])
with_d=[p for p in lb if p.get('stats',{}).get('_derived')]
print(f'{len(with_d)}/{len(lb)} players have _derived')
if with_d:
    p=with_d[0]
    der=p['stats']['_derived']
    print(f'{p[\"name\"]}: sgPutt={der[\"sgPuttingEst\"]:+.2f} sgApp={der[\"sgApproachEst\"]:+.2f} sgOtt={der[\"sgOttEst\"]:+.2f}')
    print(f'  ballStriking={der[\"ballStriking\"]} narrative={der[\"narrative\"]}')
    print(f'  fieldAvg: GIR={der[\"fieldAvg\"][\"gir\"]}% putts/GIR={der[\"fieldAvg\"][\"puttsPerGir\"]} n={der[\"fieldAvg\"][\"n\"]}')
"
# Expected: ≥5 players with _derived, leader shows plausible sgPutt and sgApp values

# 5. deploy/verify match
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/deploy/verify | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'match={d[\"match\"]}')"
# Expected: match=True
```

---

## NOTES

- `_derived` is omitted (no field attached) when a player has incomplete stats or
  fewer than 5 field players have data. Client handles missing `_derived` gracefully
  (`s._derived || {}`).
- `fieldAvg.n` indicates how many players contributed to the baseline — useful for
  logging during partial-field R1. When n < 10, treat estimates as provisional.
- `momentum` field (L15577 in client) is NOT computed here — requires prior-round
  score comparison which would need a separate D1 lookup. Leave for a follow-up.
- `notablePlayers` array on the top-level result (L15619 in client) is also NOT
  computed here — requires a ranked player lookup. Leave for a follow-up.

---

## COMMIT
```bash
git add src/index.js
git commit -m "feat(golf): _derived SG proxy via field-relative Broadie computation"
git push origin main
```
