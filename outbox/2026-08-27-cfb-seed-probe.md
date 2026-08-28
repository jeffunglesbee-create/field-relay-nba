# Before seeding CFB: two numbers nobody has

**2026-08-27** · `scripts/cfb-volume-probe.mjs`, `.github/workflows/cfb-volume-probe.yml`

Seeding CFB looked like one row in the journalism cron's `LEAGUES` table. Two
things have to be measured before that row is safe, and neither is in the record.

## 1. `groups=80` is a comment, not a parameter

`src/index.js:1212`, inside `V2_LEAGUES`:

> `groups=80` on college-football scopes to FBS -- avoids FCS/D2/D3 flooding
> results (confirmed the default returns the same count today, but the explicit
> param is the correct, robust choice, not relying on undocumented default
> behavior that could change)

**That string is the only occurrence of `groups=80` in this repository.** Nothing
appends the parameter — not `/v2/games`, not the cron's `LEAGUES` loop at 7795,
not the three other loops over the same table. The cron builds:

```js
`${ESPN_API_BASE}/sports/${sport}/${league}/scoreboard?dates=${espnDate}`
```

The client does append it. `jubilant-bassoon`'s `FETCH_LEAGUES` carries
`groupsParam:"80"` and its URL builder appends `&groups=${groupsParam}`
(`CC-CMD-2026-08-02-add-football-to-date-fixtures-sweep`, shipped and verified
live against 8 real FBS games on 2026-08-29). So the client and the relay ask
ESPN different questions about the same competition.

This was flagged 26 days ago, in that CC-CMD's own result doc on Drive, as a
"real, incidental finding (not fixed, out of scope) ... worth a future relay
CC-CMD." It stayed out of scope because nothing depended on it. Seeding CFB
makes something depend on it.

**The comment's claim is also unverified in season.** "Confirmed the default
returns the same count today" was written 2026-07-03, with no CFB games being
played. Rule 72 — an inherited claim that decides a build must be re-verified.

## 2. Volume

CFB runs 60-130+ games on a Saturday against roughly 15 for MLB. The journalism
cron fires every 15 minutes — 96 ticks a day — and each archive-write site walks
every event the fetch returns. "One row in a table" is accurate about the diff
and wrong about the effect.

## What the probe prints

Per date: unscoped count, `groups=80` count, the delta, and what the delta is.
Then the peak FBS slate measured and what the cron would walk. A run where ESPN
answers for no date exits 1 with `NOT OBSERVABLE` rather than reporting a clean
comparison it never made.

It decides nothing. It produces the two numbers the decision needs.

## Why this is a separate artifact and not folded into the seed commit

Rule 68 splits PRE-BUILD from POST-BUILD for exactly this case: the shape of the
seed change depends on the answer. If the delta is zero, a plain `LEAGUES` row is
correct and the `groups=80` gap stays a documented discrepancy. If the delta is
non-zero, the row is unsafe until the table carries a per-competition query
parameter — which means threading a new field through four loops over `LEAGUES`,
a materially larger change to a live cron path than the ask implies.

Writing the row first and measuring after would be picking the shape before
knowing which one is right.
