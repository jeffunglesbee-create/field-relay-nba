# CC-CMD — /quality/report alert recalibration

**Repo:** field-relay-nba
**Date:** 2026-06-23
**Scope:** Single surgical edit to /quality/report handler (src/index.js)

---

## BACKGROUND (verified from source)

`/quality/report` alert logic is at L7773-7781 in src/index.js.
Current filter: `scored >= 3 AND (avg_score < 170 OR below_150/scored > 0.3)`.
Flat 170 threshold applies to all brief_types.

Problems confirmed from live /quality/report output:
1. `wc_matchup`, `standings_snapshot`, `narrative_context` are enrichment
   data types (static text seeded into D1 as backfill context), not
   journalism prose. Scoring them as journalism output produces noise.
   wc_matchup clusters at 127 avg — correct for reference text, wrong
   to alert on. This masks the 3 real alerts.
2. `game_brief golf` at 91 avg is a structural gap (no context builder),
   not a tunable threshold problem. Alerting on it every report is noise.
3. `wnba_game` at 158 avg with 0 rows below 150 is flagging as failure —
   the flat 170 threshold is wrong for this type.

Real alert-worthy types: `game_recap`, `night_owl`, `mlb_game`, `wnba_game`,
`slate`, `game_brief` (MLB/WC/WNBA). Enrichment types excluded.

---

## PRE-BUILD PROBES (Rule 68)

```bash
# 1. Confirm /quality/report handler location
grep -n "'/quality/report'" src/index.js

# 2. Read alert filter block (lines around L7773)
sed -n '7770,7795p' src/index.js

# 3. Confirm ENRICHMENT_TYPES set doesn't already exist
grep -n "ENRICHMENT_TYPES\|wc_matchup.*alert\|narrative_context.*alert" src/index.js

# 4. Confirm per-type threshold logic doesn't already exist
grep -n "ALERT_THRESHOLD\|thresholdFor\|per.type" src/index.js | head -5
```

Write probe output to `outbox/cc-quality-alert-recal-2026-06-23.md`.

---

## TASK 1 — Replace alert filter in /quality/report

Find the alert filter block at L7773 (verify exact line from probe #2).

**Replace** this block:
```javascript
const alerts = summary
  .filter(r => r.scored >= 3)
  .filter(r => r.avg_score < 170 || (r.below_150 / r.scored) > 0.3)
  .map(r => ({
    brief_type: r.brief_type, sport: r.sport || 'all',
    alert: r.avg_score < 170 ? 'avg_below_170' : 'high_failure_rate',
    avg_score: r.avg_score,
    failure_pct: Math.round((r.below_150 / r.scored) * 100),
  }));
```

**With:**
```javascript
// Enrichment types: static context data seeded into D1, not journalism prose.
// Scoring them produces noise — exclude from quality alerts entirely.
const ENRICHMENT_TYPES = new Set([
  'wc_matchup', 'standings_snapshot', 'narrative_context',
  'enrichment', 'kv_harvest', 'wc_tab',
]);

// Per-type alert thresholds (245-point relay ceiling).
// Preview/pre-game types structurally score lower than post-game recaps.
// Golf excluded: no context builder exists, low score is structural not tunable.
function _alertThreshold(brief_type, sport) {
  if (ENRICHMENT_TYPES.has(brief_type)) return null; // exclude
  if (sport && sport.toLowerCase().includes('golf')) return null; // structural gap
  if (brief_type === 'game_brief') return 130; // preview type
  if (brief_type === 'night_owl')  return 140; // client-generated, lower ceiling
  return 170; // game_recap, mlb_game, wnba_game, slate — full prose types
}

const alerts = summary
  .filter(r => r.scored >= 3)
  .filter(r => {
    const threshold = _alertThreshold(r.brief_type, r.sport);
    if (threshold === null) return false; // excluded type
    return r.avg_score < threshold || (r.below_150 / r.scored) > 0.4;
  })
  .map(r => {
    const threshold = _alertThreshold(r.brief_type, r.sport);
    return {
      brief_type: r.brief_type, sport: r.sport || 'all',
      alert: r.avg_score < threshold ? `avg_below_${threshold}` : 'high_failure_rate',
      threshold,
      avg_score: r.avg_score,
      failure_pct: Math.round((r.below_150 / r.scored) * 100),
    };
  });
```

---

## TASK 2 — Add `/quality/report` to MCP allow-list if missing

```bash
grep -n "quality/report\|/quality/" src/index.js | grep -i "allow\|ALLOW\|prefix" | head -5
```

If `/quality/` is already in the MCP allow-list prefix, no change needed.
If not, add `'/quality/report'` alongside `/quality/` entries.

---

## TASK 3 — Deploy and verify

```bash
# After deploy:
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/quality/report" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    console.log("alert_count:", d.alert_count, "(target: ≤4)");
    console.log("alerts:");
    d.alerts.forEach(a => console.log(" ", a.brief_type, a.sport, "avg:", a.avg_score, "threshold:", a.threshold));
    console.log("excluded enrichment types still in summary (not alerts):");
    const EXCL=new Set(["wc_matchup","standings_snapshot","narrative_context"]);
    d.summary.filter(r=>EXCL.has(r.brief_type)).forEach(r=>console.log(" ", r.brief_type, "avg:", r.avg_score, "NOT alerting ✓"));
  '
```

**Done condition:** `alert_count ≤ 4`. `wc_matchup`, `standings_snapshot`,
`narrative_context` appear in `summary` (still visible) but NOT in `alerts`.
Real prose types (`game_recap`, `mlb_game`, `night_owl`) still alert when
below their per-type threshold.

---

## TASK 4 — Write outbox manifest

Write `outbox/cc-quality-alert-recal-2026-06-23.md`:
- Commit hash + deploy run ID
- Before: alert_count (was 10)
- After: alert_count + which alerts remain
- Confirm enrichment types excluded from alerts

---

## SCOPE (Rule 69 — TOUCH-ONLY-A)

DO:
- Edit alert filter block in /quality/report handler in src/index.js only
- Single commit + deploy

DO NOT:
- Modify summary query (enrichment types stay visible in summary)
- Modify scoring logic in journalism-quality.js
- Touch context-assembler.js
- Touch jubilant-bassoon
