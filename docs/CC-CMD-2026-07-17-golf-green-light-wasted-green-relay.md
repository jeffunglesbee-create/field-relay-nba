# CC-CMD: Add birdiesOnGir + bogeysOnGir to golf enriched endpoint

**Repo:** field-relay-nba  
**File:** `src/index.js`  
**Branch:** main — commit directly, do not create a feature branch or PR.  
**Date:** 2026-07-17  
**Pair:** Unblocks `jubilant-bassoon/docs/CC-CMD-2026-07-17-golf-green-light-wasted-green.md`  
(client CC-CMD is written and STAGED — execute it immediately after this one deploys)

## Background

The client CC-CMD for Green Light Rate and Wasted Green columns is STAGED because
the relay enriched endpoint does not serve `birdiesOnGir` or `bogeysOnGir`.

This CC-CMD adds those two fields to:
1. `handleGolfCompetitorStats` (per-tournament per-athlete, lines ~3087–3104)
2. `handleGolfPlayerStats` (season player-stats, lines ~3024–3046)  
3. The enriched endpoint's `stats` shape (lines ~3250–3256)

**Blocked by:** Unknown ESPN stat names. The probe block below must confirm
which `name` fields ESPN's API uses for these two metrics before any code is
written.

## Probe Block (run this FIRST — do not write code until names confirmed)

```bash
# Confirm HEAD
git log --oneline -5

# Step 1: Get a known current PGA event ID and a top player's athleteId.
# The enriched endpoint returns these directly — use the first leaderboard entry.
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const p = (d.leaderboard||[])[0];
    if (!p) { console.log('no leaderboard'); process.exit(1); }
    console.log('eventId:', d.eventId);
    console.log('athleteId:', p.athleteId);
  "

# Step 2: Dump ALL stat names from the competitor-stats endpoint for that
# athlete+event. This is the source of truth for what ESPN calls each metric.
# Replace EVENT_ID and ATHLETE_ID with values from Step 1.
curl -s "https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/EVENT_ID/competitions/EVENT_ID/competitors/ATHLETE_ID/statistics/0" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const flat = [];
    if (Array.isArray(d?.splits?.categories)) {
      for (const cat of d.splits.categories)
        if (Array.isArray(cat?.stats)) flat.push(...cat.stats.map(s => s.name));
    }
    if (Array.isArray(d?.stats)) flat.push(...d.stats.map(s => s.name));
    const gir = flat.filter(n => /gir|birdie|bogey|green|conversion/i.test(n));
    console.log('GIR/birdie/bogey stat names:', JSON.stringify(gir, null, 2));
    console.log('All stat names:', JSON.stringify([...new Set(flat)].sort(), null, 2));
  "

# Step 3: Same probe against common/v3 player-stats (the other ESPN endpoint).
# Replace ATHLETE_ID with the value from Step 1; SEASON is typically the year
# (2026 for the current PGA season).
curl -s "https://site.web.api.espn.com/apis/common/v3/sports/golf/athletes/ATHLETE_ID/stats?season=2026" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const ls = Array.isArray(d?.leaguesStats) ? d.leaguesStats[0] : null;
    const ev = (ls?.eventsStats||[])[0];
    const stats = Array.isArray(ev?.stats) ? ev.stats : [];
    const gir = stats.filter(s => /gir|birdie|bogey|green|conversion/i.test(s?.name));
    console.log('GIR/birdie/bogey stat names:', JSON.stringify(gir.map(s => s.name), null, 2));
    console.log('All stat names:', JSON.stringify(stats.map(s => s.name).sort(), null, 2));
  "
```

## Decision Gate

**If ESPN returns stat names matching birdie-on-GIR and bogey-on-GIR:**
→ Proceed with this CC-CMD. Use the EXACT ESPN stat name in `pickStat()`.
Expected shape: ESPN likely serves these as percentages (like `sandSaves`),
not raw counts. Confirm by checking the `value` field in the probe output.

**If ESPN returns no matching stat names:**
→ Stop. Both Green Light Rate and Wasted Green remain permanently STAGED.
Update the client CC-CMD and jubilant-bassoon session doc to reflect this.

**If ESPN returns raw counts (not percentages):**
→ Relay computes the percentage: `count / girHit * 100` before serving.
Use `girPoss` or the per-round `thru` value as the denominator — confirm
which from probe output. The client CC-CMD treats `birdiesOnGir` as
already a percentage (rounds and appends `%`).

## Changes (only if probe confirms ESPN field names)

### 1. `handleGolfCompetitorStats` — add two pickStat calls (line ~3091–3104)

After `sandSavesPossible: pickStat('sandSavesPoss'),` add:

```javascript
birdiesOnGir: pickStat('CONFIRMED_ESPN_NAME_FOR_BIRDIE_ON_GIR'),
bogeysOnGir:  pickStat('CONFIRMED_ESPN_NAME_FOR_BOGEY_ON_GIR'),
```

Replace the CONFIRMED_ESPN_NAME placeholders with the actual names from the probe.

### 2. `handleGolfPlayerStats` — add same two pickStat calls (line ~3039–3045)

Same fields, same ESPN names (both endpoints use the same stat name scheme).
After `sandSavesPossible: pickStat(stats, 'sandSavesPoss'),` add:

```javascript
birdiesOnGir: pickStat(stats, 'CONFIRMED_ESPN_NAME_FOR_BIRDIE_ON_GIR'),
bogeysOnGir:  pickStat(stats, 'CONFIRMED_ESPN_NAME_FOR_BOGEY_ON_GIR'),
```

### 3. Enriched endpoint stats shape (line ~3250–3256)

In the `stats:` block of the enriched `lb.map()`:

```javascript
stats: {
    gir:              s ? (s.gir ?? 0) : 0,
    drivingDistance:  s ? (s.driveDistAvg ?? 0) : 0,
    drivingAccuracy:  s ? (s.driveAccuracyPct ?? 0) : 0,
    puttsPerGir:      s ? (s.puttsGirAvg ?? 0) : 0,
    sandSaves:        s ? (s.sandSaves ?? 0) : 0,
    birdiesOnGir:     s?.birdiesOnGir ?? null,   // null = not available, 0 = confirmed zero
    bogeysOnGir:      s?.bogeysOnGir  ?? null,
},
```

Use `null` not `0` as the default — the client distinguishes "no data" (null)
from "zero birdies on GIR" (0). The client CC-CMD guards on `!= null`.

### 4. Update CONTRACTS.md

Add the two new fields to the `/v2/golf/enriched` per-player stats entry.

## Scope Boundary — Do Not Touch

- `_attachDerived()` — keep; it doesn't need these fields
- `buildGolfPromptContext` — keep
- Any other route or cron handler
- `wrangler.toml` — do not touch

## Commits

One concern per commit:

1. `feat: add birdiesOnGir + bogeysOnGir to golf competitor-stats and player-stats handlers`
2. `feat: expose birdiesOnGir + bogeysOnGir in golf enriched endpoint stats shape`
3. `docs: update CONTRACTS.md with new golf enriched stats fields`

## Done Condition

```bash
# After deploy — probe the live enriched endpoint
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched" \
  | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const p = (d.leaderboard||[])[0];
    if (!p) { console.log('no leaderboard'); process.exit(1); }
    console.assert('birdiesOnGir' in p.stats, 'birdiesOnGir missing from stats shape');
    console.assert('bogeysOnGir' in p.stats, 'bogeysOnGir missing from stats shape');
    console.log('birdiesOnGir:', p.stats.birdiesOnGir);
    console.log('bogeysOnGir:', p.stats.bogeysOnGir);
    console.log('RELAY UNBLOCKED — run client CC-CMD');
  "
```

Once `RELAY UNBLOCKED` prints, execute the client CC-CMD:
`jubilant-bassoon/docs/CC-CMD-2026-07-17-golf-green-light-wasted-green.md`

## STAGED Status

**STAGED** pending ESPN field name probe (sandbox blocks external HTTP).

**Blocked by:** Unknown ESPN stat names for birdie-or-better on GIR and
bogey-or-worse on GIR. Probe Step 2 above will resolve this.

**Unblocked when:** Probe returns non-empty GIR/birdie/bogey stat names
from ESPN competitor-stats or common/v3 endpoints.

## Outbox Manifest (last task)

Write `outbox/cc-session-{date}-golf-green-light-wasted-green-relay.md` after
completing all tasks, containing:

- HEAD before and after (all 3 commits)
- Probe output: exact ESPN stat names found
- Whether ESPN serves percentages or raw counts
- Integration status: STAGED or VERIFIED
- Pointer to client CC-CMD: `jubilant-bassoon/docs/CC-CMD-2026-07-17-golf-green-light-wasted-green.md`
