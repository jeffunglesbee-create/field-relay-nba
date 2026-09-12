# CC session 2026-09-11 — three numeric collapses, one of them a live daily cron

Rule 67 session doc. Executed as Task 3 of jubilant-bassoon's
`docs/CC-CMD-2026-09-11-rule99-distinguishability.md`; the relay half had no
session doc of its own.

HEAD `257b0b5` → `9ee7df1`. Commits `dc7df57`, `2aa7038`, `9ee7df1`.
Deploy: `deploy.yml`, SUCCESS.

## What was collapsed

`quotaRemaining` could not distinguish **"the vendor sent no header"** from
**"zero credits left"**. Both arrived as `0`:

```js
const remaining = parseInt(res.headers.get('x-requests-remaining') || 0, 10);
```

Three sites: `src/index.js:6503` (the live odds loop), `:6603` (the historical
loop), `src/wp-resolver.js:268`.

`readQuotaHeader` in `src/budget-helpers.js` now returns `number | null` — null
for absent, empty or unparseable — and both loops gate on the null separately:

```js
if (typeof lastQuota === 'number' && lastQuota < ODDS_QUOTA_FLOOR) return lastQuota;
```

## The one that was actually running

`.github/scripts/odds-backfill.js` is a **live daily cron at 10:00 UTC**. It
sized its entire day's budget from that fabricated zero, so a silent vendor
header meant the whole run no-opped — every day, with no failure anywhere.

`main()` now throws when remaining is null rather than sizing a budget from a
number nobody sent.

## Two measuring instruments that reported clean from their own blindness

`9ee7df1`, and the more useful half of this session:

1. **`scripts/check-quota-gate-ordering.mjs` passed all three of its own
   mutations for the wrong reason.** Its anchor, `await fetchSportOddsLive(env,
   sportKey)`, also appears in `/identity/mismatches` — so every "catch" was an
   anchor-uniqueness error, not a detection. Fixed: anchors are full
   destructuring lines, and a mutation must be caught by its own property letter.

2. **`scripts/soccer-league-mislabel-scope.mjs` used `?? 0`** — the same collapse
   it was built to look for. UNKNOWN is now a third reported outcome.

A check that passes because it cannot see is indistinguishable from a check that
passes because the code is right. Both of these had been green.

## Verification

- `scripts/check-quota-gate-ordering.mjs` — property B is "`.error` checked
  BEFORE `.results` read", not a line window. Three mutations, each caught by its
  own letter.
- Deploy SUCCESS; the `[skip ci]` convention respected (no deploy-trigger path
  touched by the doc commits).

## What I got wrong

Reported three mutations as caught when all three were anchor collisions. The
harness was wrong, not the code, and I believed it because it was green — which
is the precise failure mode Rule 90 exists for, committed inside the work that
cites Rule 90.

## Open

`docs/CC-CMD-2026-09-11-odds-key-map-reconcile.md` Task 2 — the budget
projection, which also gates the `ucl`/`europa`/`conference` → `null` map gap.
