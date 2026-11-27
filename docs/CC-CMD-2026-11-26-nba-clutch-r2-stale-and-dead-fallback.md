# Claude Code Command — the NBA clutch R2 objects are 15 days old, the writer hardcodes last season, and the R2-miss fallback points at a path that never existed

**Repo:** field-relay-nba (`src/nba-clutch-r2.js`, `src/index.js`, `src/stale-data-sentinel.js`) · **Branch:** main — commit directly, no feature branch or PR · **Type:** B (stale data served; no error)
**Filed:** 2026-11-26, found while retiring the superseded GitHub workflow `nba-clutch-update.yml` in jubilant-bassoon (the dead-cron fix; reader report in this session).
**Status:** FILED, not dispatched.
**Confidence gate:** >= 95 before any commit. A change to `src/**` deploys; it needs the owner's order to dispatch a deploy only if it is not a push to main (pushes deploy by design).

## What was read (2026-11-26, 0 credits; reads only)

- `GET /health/sources?force=1` at 21:44Z: `nba_clutch_playoffs` (15 entries) and `nba_clutch_regular` (30 entries) both `uploaded` **2026-11-11T12:45Z**, `ageHours` 369, `maxAgeHours` 24, `stale: true`. Nothing wrote them since.
- The writer is relay-native (`src/nba-clutch-r2.js:2`, header "replaces GitHub Actions hybrid"; keys `nba/2026/clutch_playoffs.json` and `clutch_regular.json`, `env.FIELD_DATA.put` at line 110). Its cron gate (`src/index.js` ~10291-10296) allows Wednesday 12:00-12:59 UTC outside June and July, Monday/Wednesday/Friday inside. Wednesdays 2026-11-18 and 2026-11-25 both passed with no refresh.
- `src/nba-clutch-r2.js:44` hardcodes `Season '2025-26'`; the 2026-27 season is under way.
- `src/stale-data-sentinel.js:146` uses a 24-hour limit against a weekly cadence, so the two clutch rows read stale six days in seven even when the writer is healthy.
- `src/index.js:20335-20356` describes the GitHub Actions hybrid ("stats.nba.com returns 520 from CF Workers") and, on an R2 miss, falls back to `raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/nba/`, a path that has never existed (no commit in that repo ever touched `outbox/nba/`). The workflow that was meant to write it is deleted in jubilant-bassoon commit `1606d7a`.

## Not established (Rule 100)

Why the writer did not refresh on 11-18 and 11-25 (a swallowed `{ok:false}` from `stats.nba.com`, the `count === 0` guard, the */15 tick, or the gate); whether a Worker can reach `stats.nba.com` at all (the retired hybrid existed because it could not: "520 from CF Workers"); whether the 2026-11-11 upload was the cron or a manual POST; whether any outside reader uses the raw-GitHub fallback.

## Tasks (probe first, Rule 87)

1. **Probe:** read what `runNBAClutchUpdate` returns and where the cron caller logs a throw (`src/index.js` ~10294-10296); read the relay's recorded outcome for a Wednesday tick if one exists (`outbox/health-sources-*.json` history shows `uploaded` unchanged since 11-11); decide, from that, which of the four causes above is real.
2. **Fix the cause, not the symptom:** if the Worker cannot reach the vendor, the writer needs a path that can (a runner, as the NFL player stats now do), not another fallback. Compute the season from the date instead of hardcoding it. Make the sentinel's limit match the cadence. Delete the dead raw-GitHub fallback and the stale comment (a fallback to a path that never existed is a Rule 76 violation).
3. **Mutation first (Rule 90)** for each new check.

## Done condition (Rule 89)

```
GET /health/sources?force=1   # nba_clutch_playoffs and nba_clutch_regular: uploaded within 8 days of the check, stale false, against a limit that matches the cadence
git grep -n 'raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/nba' origin/main -- src   # no match
grep -n "Season *[:=] *'2025-26'" src/nba-clutch-r2.js    # no match
```
