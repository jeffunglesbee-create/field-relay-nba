# CC-CMD C: BSD Momentum Context Source
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Sequence:** After CC-CMD-A. · **Rule 87:** Self-completing.

## WHAT THIS ADDS

Adds `bsd_momentum` as a new CONTEXT_SOURCE in context-assembler.js.
The BSD momentum endpoint returns a minute-by-minute pressure index (−100 to +100).
This is qualitatively different from ESPN's cumulative xG — it shows WHEN the game shifted.

Journalism prompt injection example:
```
[BSD MOMENTUM]
Game shifted at 71st min: pressure index swung from +12 (balanced) to +78 (home dominance).
Peak home pressure: 82 at 74th min. Peak away pressure: -61 at 34th min.
```

Requires: CC-CMD-A deployed (BSD relay routes live, /bsd/events/:id/momentum responding).
Requires: game.bsdEventId — the BSD match ID. Must be sourced from /bsd/events/live match.

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba

# 1. Confirm CC-CMD-A deployed
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live | jq '.count'
# Expected: integer

# 2. Get a live BSD event ID and probe momentum
BSD_ID=$(curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['events'][0]['id'] if d.get('events') else '')")
echo "BSD_ID=$BSD_ID"
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/${BSD_ID}/momentum" | head -c 400
# Expected: JSON with momentum values array

# 3. Confirm bsd_momentum NOT in context-assembler yet
grep -c 'bsd_momentum' src/context-assembler.js
# Expected: 0

# 4. Find CONTEXT_SOURCES insertion point
grep -n 'soccer_xg' src/context-assembler.js
# Note line — add bsd_momentum after soccer_xg entry
```

## TASK 1 — Add buildBSDMomentumContext function to context-assembler.js

Add BEFORE the CONTEXT_SOURCES array definition:

```javascript
// ── BSD Momentum Context ──────────────────────────────────────────────────────
// Requires game.bsdEventId (BSD internal match ID from /bsd/events/live).
// Returns '' when: no bsdEventId, API unavailable, or match not in BSD database.
// Momentum index: −100 (away dominance) → +100 (home dominance), per minute.
async function buildBSDMomentumContext(env, game) {
    const bsdId = game.bsdEventId || game.bsdId;
    if (!bsdId) return '';
    try {
        const base = `https://field-relay-nba.jeffunglesbee.workers.dev`;
        const resp = await fetch(`${base}/bsd/events/${bsdId}/momentum`,
            { headers: { 'User-Agent': 'FIELD/1.0' } });
        if (!resp.ok) return '';
        const d = await resp.json();
        const vals = (d.momentum || d.results || d.data || [])
            .filter(m => m.value != null);
        if (!vals.length) return '';

        // Find the biggest swing (where the game shifted)
        let maxSwing = 0, shiftMinute = null;
        for (let i = 1; i < vals.length; i++) {
            const swing = Math.abs(vals[i].value - vals[i-1].value);
            if (swing > maxSwing) { maxSwing = swing; shiftMinute = vals[i].minute ?? i; }
        }

        const peakHome = Math.max(...vals.map(v => v.value));
        const peakAway = Math.min(...vals.map(v => v.value));
        const current = vals[vals.length - 1];

        const lines = ['', '[BSD MOMENTUM]'];
        if (shiftMinute && maxSwing >= 15) {
            const before = vals[vals.indexOf(vals.find(v => (v.minute ?? 0) >= shiftMinute)) - 1]?.value ?? 0;
            const after  = vals.find(v => (v.minute ?? 0) >= shiftMinute)?.value ?? 0;
            const dir = after > 0 ? 'home dominance' : 'away dominance';
            lines.push(`Game shifted at ${shiftMinute}': pressure index ${before > 0 ? '+' : ''}${Math.round(before)} → ${after > 0 ? '+' : ''}${Math.round(after)} (${dir})`);
        }
        if (peakHome >= 30) lines.push(`Peak home pressure: +${Math.round(peakHome)}`);
        if (peakAway <= -30) lines.push(`Peak away pressure: ${Math.round(peakAway)}`);
        if (current) lines.push(`Current: ${current.value > 0 ? '+' : ''}${Math.round(current.value)} (${current.value > 15 ? 'home' : current.value < -15 ? 'away' : 'balanced'})`);

        return lines.length > 2 ? lines.join('\n') : '';
    } catch (_) { return ''; }
}
```

## TASK 2 — Add bsd_momentum to CONTEXT_SOURCES

After the `soccer_xg` entry:

OLD:
```javascript
    { id: 'soccer_xg',    priority: 7, budget: 150, builder: buildSoccerXGContext,
      sports: ['epl', 'mls', 'ucl', 'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'soccer'] },
];
```

NEW:
```javascript
    { id: 'soccer_xg',    priority: 7, budget: 150, builder: buildSoccerXGContext,
      sports: ['epl', 'mls', 'ucl', 'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'soccer'] },
    // BSD momentum: minute-by-minute pressure index. Requires game.bsdEventId.
    // Provides the "when the game shifted" signal ESPN lacks.
    { id: 'bsd_momentum', priority: 8, budget: 120, builder: buildBSDMomentumContext,
      sports: ['epl', 'mls', 'ucl', 'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'soccer', 'atp', 'wta'] },
];
```

## TASK 3 — Export buildBSDMomentumContext

Add to the exports block at bottom of context-assembler.js:

OLD:
```javascript
    buildNBAClutchContext,
    buildSoccerXGContext,
    buildESPNSummaryContext,
};
```

NEW:
```javascript
    buildNBAClutchContext,
    buildSoccerXGContext,
    buildESPNSummaryContext,
    buildBSDMomentumContext,
};
```

## DONE CONDITIONS

```bash
# 1. Smoke passes
node smoke.js 2>&1 | tail -3

# 2. bsd_momentum in CONTEXT_SOURCES
grep -c 'bsd_momentum' src/context-assembler.js
# Expected: 2 (definition + entry)

# 3. Builder exported
grep 'buildBSDMomentumContext' src/context-assembler.js | wc -l
# Expected: ≥ 3 (function def, CONTEXT_SOURCES entry, export)

# 4. diff — context-assembler.js only
git diff --stat
```

## COMMIT

```bash
git add src/context-assembler.js
git commit -m "feat(context): bsd_momentum context source — minute-by-minute pressure index"
git push origin main
```
