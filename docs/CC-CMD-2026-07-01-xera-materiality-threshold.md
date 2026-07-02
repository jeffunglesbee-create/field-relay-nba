# Claude Code Command — Add Magnitude Threshold to xERA Materiality Check

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-xera-materiality-threshold-2026-07-01.md.

## CONTEXT

`isMaterialChange()` (`src/brief-freshness.js`) has one confirmed,
real tuning gap: the Savant xERA branch flags ANY xERA field change as
material, with no magnitude threshold —

```javascript
if (_SAVANT_SOURCES.has(src) &&
    (field.includes('starter') || field.includes('xera'))) {
    return { material: true, reason: 'starter_changed' };
}
```

xERA updates continuously and can shift by trivial rounding-level
amounts after any single appearance. Contrast with the odds branch,
which correctly requires a genuine favorite *flip* (sign change), not
just any movement — the same discipline needs to apply here before this
function is wired to dispatch anything downstream (a
`JOURNALISM_QUEUE` "brief-correction" job type is planned as a
follow-up CC-CMD, not yet built — do not build that here, this CC-CMD
is scoped to the threshold fix only).

**Also note the `reason` string is wrong for xERA changes** —
`'starter_changed'` is returned even when the actual trigger was an
xERA delta, not a starter swap. Fix this too; it's a one-line
correctness issue in the same block, not a separate task.

**Explicitly out of scope:** the lineup `field.includes('starter')`
check. Unlike xERA, there's no confirmed evidence this is
mistuned — checked, but no real `change_log` data was examined to
confirm or rule out false-positive risk there. Do not touch it without
that evidence first; note it in the outbox as a real, separate,
unconfirmed follow-up item.

## PRE-BUILD PROBE (Rule 87)

```bash
sed -n '1,60p' src/brief-freshness.js
```

**Required before choosing a threshold — do not invent a number.** Pull
real historical xERA deltas from actual committed `expected_stats.json`
snapshots (multiple weekly commits already exist in `jubilant-bassoon`,
same repo the `mlb-weekly-update.yml` cron writes to) to see what a
typical week-over-week xERA change actually looks like for the same
player, across several real players. Use that real distribution to pick
a threshold that separates "genuine narrative shift" from "normal
noise" — do not pick a round number without this evidence. If real
historical snapshots aren't accessible from the CC sandbox, use the
CI-as-proxy pattern (same technique already used successfully this
session for Savant probing) rather than guessing.

## TASK 1: Add a real magnitude threshold

```javascript
// Savant — starter swap (unconditional) or xERA delta above a real
// materiality threshold (see outbox for the historical-data basis of
// this number — not an arbitrary round figure).
if (_SAVANT_SOURCES.has(src) && field.includes('starter')) {
    return { material: true, reason: 'starter_changed' };
}
if (_SAVANT_SOURCES.has(src) && field.includes('xera')) {
    const oldV = parseFloat(change.old_value);
    const newV = parseFloat(change.new_value);
    if (!Number.isFinite(oldV) || !Number.isFinite(newV)) {
        return { material: false, reason: '' };
    }
    const delta = Math.abs(newV - oldV);
    if (delta >= /* THRESHOLD — fill from probe evidence */) {
        return { material: true, reason: 'xera_shift' };
    }
    return { material: false, reason: '' };
}
```

Fix the reason string bug in the same edit — `'starter_changed'` must
never be returned for an xERA-triggered match.

## TASK 2: Verification

```bash
node -c src/brief-freshness.js
```

No existing smoke coverage for this file (relay-side, not
`smoke.js`'s domain) — if a lightweight unit-style check is reasonable
to add inline (e.g. a small self-test block, matching any existing
convention in this file or elsewhere in the relay for testing pure
functions), add one confirming: a genuine large xERA swing still
returns `material: true`, a trivial rounding-level change returns
`material: false`, and the `reason` string is correct in both the
starter and xERA cases. If no such convention exists in this repo,
don't invent one — note that in the outbox instead.

## TASK 3: Outbox manifest (last task)

State explicitly: the real historical xERA deltas examined and their
range, the threshold chosen and why it's grounded in that data rather
than picked arbitrarily, and confirm the lineup `starter` check was
left untouched as specified.
