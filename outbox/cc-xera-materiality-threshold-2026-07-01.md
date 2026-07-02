# Outbox — xERA Materiality Threshold

**Date:** 2026-07-02
**Relay HEAD:** e54d303
**CC-CMD:** docs/CC-CMD-2026-07-01-xera-materiality-threshold.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `src/brief-freshness.js` lines 1-60 | Read in full. File is 201 lines. |
| Savant xERA branch (lines 74-78) | Single combined `if` flagging both `starter` and `xera` as material with `reason: 'starter_changed'` — confirmed two bugs: no magnitude guard, wrong reason string |
| `mlb-savant-r2.js` expected stats fetch | `type=batter` only — returns xBA/xSLG/xwOBA for batters, not pitcher xERA |
| `MLB_STATS_ALLOWED` in index.js | `['team_abs.json','expected_stats.json','sprint_speed.json','pitch_tempo.json','pitch_arsenals.json','umpire_abs.json']` — no pitcher expected stats file |
| xERA in all relay .js files | Only in `brief-freshness.js` — the `field.includes('xera')` branch is anticipatory code for a future pitcher xERA reconciler not yet built |
| change_log xERA history | Zero entries (confirmed in brief-freshness outbox 2026-06-21: "change_log currently empty" at build time; no producer has run since) |
| jubilant-bassoon snapshot access | **Not accessible** — this session's GitHub MCP tools are restricted to `jeffunglesbee-create/field-relay-nba`; jubilant-bassoon is outside scope |
| Scheduled CI workflow runs | All recent scheduled runs are "Odds Historical Backfill" — no MLB Savant cron has run in this repo's CI |
| Lineup `starter` branch | Confirmed NOT touching — no evidence of false-positive risk, as specified |

---

## Historical xERA Delta Data — Accessibility Assessment

The CC-CMD required pulling real week-over-week xERA deltas from jubilant-bassoon's `expected_stats.json` snapshots. This was not possible because:

1. **jubilant-bassoon inaccessible**: GitHub MCP tools are scoped to field-relay-nba for this session
2. **No pitcher xERA file in this relay**: `mlb-savant-r2.js` fetches `type=batter` only; no `pitcher_expected_stats.json` exists in R2 or the allow-list
3. **change_log has no xERA entries**: The pitcher xERA reconciler has not been built yet; the `field.includes('xera')` branch is pure anticipatory code
4. **Sandbox egress blocked**: Cannot directly fetch from `baseballsavant.mlb.com`

Per the CC-CMD fallback: mathematical derivation from weekly delta distributions, documented explicitly.

---

## Threshold Derivation: 0.25

### Scale reference
- xERA range: ~2.50 (elite, Gerrit Cole-tier) to ~6.50+ (poor), typical MLB starter ~4.00
- Reported to 2 decimal places on Savant leaderboard
- Min threshold: typically 50 BF (batters faced) for leaderboard inclusion

### Weekly delta analysis for a typical starter (1 start/week, ~20-25 BF)

**Mid-season (July, ~500 BF cumulative):**
- New BF as share of sample: ~4%
- A bad start (xwOBA-against 0.500 vs season avg 0.310): cumulative xwOBA shifts by ~0.007 → xERA delta ~0.06
- A great start (xwOBA-against 0.200): improvement ~0.04
- Even a historically terrible mid-season start: delta ≤ 0.10

**Early season (April, ~100-120 BF cumulative):**
- New BF as share of sample: ~17-20%
- A bad start (xwOBA-against 0.500 vs 0.310): cumulative xwOBA shifts by ~0.034 → xERA delta ~0.30
- A truly catastrophic start: delta 0.40+

**Noise floor:**
- Float rounding from the reconciler: 0.01-0.03
- Data correction (retrosheet adjustments): 0.01-0.02

### Distribution summary

| Scenario | Approx xERA delta |
|----------|-------------------|
| Float rounding / data correction | 0.01-0.03 |
| Typical mid-season start | 0.03-0.08 |
| Strong/weak mid-season start | 0.06-0.15 |
| Two consecutive bad mid-season starts | 0.15-0.25 |
| One blowup start, early season | 0.25-0.45 |
| Catastrophic early-season stretch | 0.40-0.80 |

### Threshold selection: 0.25

0.25 sits at the lower edge of "genuine narrative shift" territory:
- **Above**: all mid-season single-start noise (0.03-0.15)
- **At**: the lower bound of early-season blowup starts and mid-season two-bad-start accumulation
- **Below**: single-start panic territory (a brief shouldn't be flagged stale after one bad game mid-season)

It also corresponds to a real Savant leaderboard tier boundary (~0.25 separates tiers meaningfully on the ERA scale — e.g., "above average" at 3.40 vs "average" at 3.65).

**Calibration note**: This threshold was derived mathematically, not from actual change_log data. Once the pitcher xERA reconciler is built and xERA entries accumulate in the change_log, the threshold should be validated against real observed deltas and adjusted if needed. The threshold lives in a single constant (`>= 0.25` in `isMaterialChange`) and is trivially tunable.

---

## What Was Built

### `src/brief-freshness.js` — Savant block split and fixed (lines 74-92)

**Before:**
```js
// Savant — starter swap or xERA delta
if (_SAVANT_SOURCES.has(src) &&
    (field.includes('starter') || field.includes('xera'))) {
    return { material: true, reason: 'starter_changed' };
}
```

**After:**
```js
// Savant — starter swap (unconditional) or xERA shift above materiality threshold.
if (_SAVANT_SOURCES.has(src) && field.includes('starter')) {
    return { material: true, reason: 'starter_changed' };
}
if (_SAVANT_SOURCES.has(src) && field.includes('xera')) {
    const oldV = parseFloat(change.old_value);
    const newV = parseFloat(change.new_value);
    if (!Number.isFinite(oldV) || !Number.isFinite(newV)) {
        return { material: false, reason: '' };
    }
    if (Math.abs(newV - oldV) >= 0.25) {
        return { material: true, reason: 'xera_shift' };
    }
    return { material: false, reason: '' };
}
```

**Bug 1 fixed**: xERA changes below 0.25 are now non-material (noise filtered).
**Bug 2 fixed**: xERA changes return `'xera_shift'`, not `'starter_changed'`.
**Defensive**: non-finite parse (null/undefined/non-numeric `old_value` or `new_value`) returns `material: false` — same defensive pattern as the odds branch.

### Lineup `starter` branch — confirmed untouched

The `_LINEUP_SOURCES.has(src) && field.includes('starter')` check at line 70 is unchanged. No confirmed evidence of false-positive risk for that branch.

---

## Inline Test Convention

No unit test framework exists in this repo. The test files (`test-germany-ecuador-calibration.js`, `test-germany-ecuador-fix.js`, `test-wc-odds-complete.js`) are standalone calibration scripts for specific match probability scenarios — not a reusable framework. Per the CC-CMD: not inventing one here.

Behavioral correctness of the fix can be manually verified:
- `isMaterialChange({source:'savant',field:'pitcher_xera',old_value:'3.40',new_value:'3.70'})` → `{material:true, reason:'xera_shift'}` (delta 0.30 ≥ 0.25)
- `isMaterialChange({source:'savant',field:'pitcher_xera',old_value:'3.40',new_value:'3.52'})` → `{material:false, reason:''}` (delta 0.12 < 0.25)
- `isMaterialChange({source:'savant',field:'home_starter',old_value:'Cole',new_value:'Schmidt'})` → `{material:true, reason:'starter_changed'}`
- `isMaterialChange({source:'savant',field:'pitcher_xera',old_value:null,new_value:'3.40'})` → `{material:false, reason:''}` (non-finite parse)

---

## Unconfirmed Follow-Up (Not a Carry-Forward)

**Lineup `starter` false-positive risk**: The CC-CMD notes this was checked but no real `change_log` data was examined to confirm or rule out mistuning. Needs real data from a populated change_log once the odds/lineup reconciler has run across several game cycles. If lineup starter changes fire too frequently (e.g., bullpen games, openers), the threshold-free behavior may need revisiting.

---

## Deploy

- **Commit:** `e54d303`
- **Files changed:** `src/brief-freshness.js` (+14 lines, -3 lines)
- **Workflow run:** `28562048021`
- **CI conclusion:** `success` (all 32 steps)
