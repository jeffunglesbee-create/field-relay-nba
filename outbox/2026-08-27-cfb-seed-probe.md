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

---

## ANSWERED 2026-08-27, and CFB is seeded

Probe run, artifact `outbox/cfb-volume-probe-latest.txt`:

```
  date        unscoped   groups=80   delta
  20260829         8          8       0
  20260905        68         68       0
  20260912        80         80       0
  20260919        71         71       0
```

**Delta 0 on all four dates.** The V2_LEAGUES comment's claim holds in season, so
the plain URL is correct today and a plain `LEAGUES` row is safe. The asymmetry
remains real — the relay relies on an undocumented ESPN default that
jubilant-bassoon does not — and closing it means threading a per-row query
parameter through four loops over `LEAGUES`. That is its own change, not a
hitchhiker on a seed row (Rule 69).

**Peak slate: 80 games**, against ~15 for MLB. The largest single slate any row
in that table adds. Recorded in the row's own comment so the next reader does not
have to re-measure it.

### The label, declared before any row lands

`'CFB'`. The archive writes `sport: gm.league` from this field, so a label chosen
after the fact orphans rows already written (`CC-CMD-2026-08-20-brief-data-quality`
ask 3). `'CFB'` matches the table's short-name register (NBA/NHL/MLB/NFL) and
jubilant-bassoon's own `FETCH_LEAGUES` `section:"CFB"`. The client's
`'College Football'` is a section **heading**, not a sport key — its `_sport` is
the lowercase slug `cfb`.

### A defect in my own self-test, found by this change

The seed-coverage self-test asserted `classify('cfb', …) === 'undecided'` against
the **live manifest**. Seeding CFB moved `cfb` out of `UNDECIDED` and the test
failed — for a change that was correct.

It was reaching into production data for a fixture, so it tested the manifest's
contents rather than the classifier's logic. `classify` now takes the two maps as
parameters defaulting to the module's, and the self-test passes its own. A third
assertion was added while the seam was open: a key that appears in a manifest map
AND gets seeded must read as `seeded`, which is exactly the transition CFB just
made and nothing had covered.

10 self-tests, was 9.
