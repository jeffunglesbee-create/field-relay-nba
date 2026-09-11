# Odds key-map reconcile — STOPPED AT TASK 0 — 2026-09-11

**CC-CMD:** `docs/CC-CMD-2026-09-11-odds-key-map-reconcile.md`
**Status:** **Tasks 1, 2 and 3 NOT executed.** Task 0's gates returned a blocking
answer: the document's stated cause is disproven at HEAD. Confidence that the
prescribed fix would fix the reported symptom: **~40**, against the dispatcher's
floor of 95.

No map was changed. No odds path was enabled. No Odds API credit was spent.

## TASK 0.1 — the four maps, read at HEAD

| location | entries | keyed by |
|---|---|---|
| `index.js:6332` `ODDS_SPORT_KEYS` | **6** | `sport\|league` |
| `index.js:6344` `ARCHIVE_SPORT_TO_ODDS_KEY` | **16** | short code |
| `ambient-do.js:67` `ODDS_SPORT_KEYS` | **11** | short code |
| `wp-resolver.js:53` `ARCHIVE_SPORT_TO_ODDS_KEY` | **16** | short code |

The CC-CMD's table says ambient-do holds an unspecified "own copy". It holds
eleven entries, **and `mls: 'soccer_usa_mls'` is one of them**, alongside
`laliga`, `seriea`, `bundesliga`, `ligue1`.

My first extraction of these maps was itself wrong — it matched only
quote-delimited keys and silently dropped every unquoted one, reporting
ambient-do as 3 entries. The corrected census is above.

## TASK 0.3 — the gate, and it blocks

> *blame both maps before treating any omission as a defect*

```
git log -L 67,80:src/ambient-do.js
043f4d6  feat: live in-play odds — AmbientDO integration
+const ODDS_SPORT_KEYS = {
+    'nba' … 'mls': 'soccer_usa_mls', 'laliga' … 'ligue1' …   ← eleven, at creation
```

**That map was born with eleven entries and those lines have never been changed
since.** It was never six. The CC-CMD's mechanism — *"both live paths skip any
sport not in the six"* — cannot have produced the MLS symptom, because MLS is in
the map that gates the ambient path.

**Where the document's claim came from.** It cites `index.js:12875`:

> *"This block stays as the writer for sports AmbientDO does not cover (its
> `ODDS_SPORT_KEYS` is six sports)"*

That comment is **stale**, and the CC-CMD inherited it rather than reading the
map. A claim taken from a comment instead of the source is the substitution this
repo ratchets against, and it is the reason the document's whole diagnosis is
wrong.

**This repo had already killed the mapping hypothesis.** `scripts/probe-odds-api.mjs`,
written 2026-08-21 for the near-identical EPL/La Liga symptom, opens:

> *"The sport-key maps are NOT the cause — `src/index.js` has `epl` and
> `'la liga'`, and `ambient-do.js` has both too. So the mapping hypothesis is
> already dead and this probe does not re-test it."*

## The corrected census — what is actually true

`outbox/odds-coverage-census.log`, read live from `/context/date/{date}`:

```
2026-09-06                          rows opening closing draw
  Bundesliga    2   0  0  0      CFL       1   1  1  0
  CFB           3   0  0  0      EPL       2   2  2  2
  La Liga       4   3  2  3      Ligue 1   3   3  3  3
  MLB          15  14  8  0      MLS       8   0  0  0
  Serie A       4   3  3  3
2026-09-10
  CFB  1 0 0 0   MLB 5 5 5 0   MLS 9 0 0 0   NFL 1 0 0 0
  UEFA Champions League  6  0  0  0
```

**The CC-CMD's three-way claim is CORRECT and my first census said otherwise.**
`hasDraw` read only the top level of the odds object; the relay nests the prices
(`{"source":"draftkings","moneyline":{"home":-210,"away":160}}`), so every soccer
row came back draw 0 — including the ones that carry a draw. Fixed in `fe4fefa`.
That false zero pointed at the dispatcher's hard gate and would have
**manufactured a confirmation** of the 2026-08-23 two-way finding on clean data.
Corrected: EPL 2/2, La Liga 3, Ligue 1 3, Serie A 3 all carry draws; CFL 0 and
MLB 0 are correct, neither has a draw.

## The symptom splits in two, and only one half is a map problem

**A map gap — real, and not the one the CC-CMD describes.**
`UEFA Champions League` → `archiveSportToOddsKey` lowercases to
`uefa champions league` → **absent from the 16-entry map**, which has no `ucl`,
`europa` or `conference`. UCL 6 rows / 0 odds is explained.

**Not a map gap — MLS, Bundesliga, CFB, NFL.** All four resolve:
`MLS` → `mls` → `soccer_usa_mls`, and so on. The opening-odds writer selects
`DISTINCT sport … WHERE opening_odds IS NULL` and buckets by
`archiveSportToOddsKey()`, so these sports **are attempted** and produce nothing.
The cause is downstream of every map in the CC-CMD's table.

### The candidate I can point at, without claiming it is the cause

`src/index.js:6567`, inside the per-sport loop:

```js
for (const sport of sports) {
  const sportKey = archiveSportToOddsKey(sport);
  if (!sportKey) continue;
  if (lastQuota !== null && lastQuota < ODDS_QUOTA_FLOOR) return lastQuota;   // ← RETURN
```

A **`return`, not a `continue`**. Every sport after the one that trips the floor
gets nothing, and the iteration order comes from D1's `DISTINCT` — so which
sports get odds is arbitrary rather than chosen. `probe-odds-api.mjs` named this
in August as hypothesis H2 and it is unchanged at HEAD.

It is **a** candidate, not the answer. Two others remain live, and this repo has
a probe for each: vendor coverage (`probe-odds-api.mjs`, `/v4/sports` is the
documented zero-credit endpoint) and team-name matching
(`probe-odds-team-names.mjs`). Guessing between three is what the CC-CMD did.

## TASK 0.4 — NOT ANSWERED

> *confirm with the vendor that `soccer_usa_mls` actually returns markets — the
> key existing in our source is not evidence the vendor serves it*

Correct, and still unanswered. It needs `probe-odds-api.mjs` run with the key on
a runner. It is the single highest-value next step, because if the vendor does
not serve MLS in-season then nothing in Tasks 1–3 would have helped and the
budget projection in Task 2 would have been computed for calls that return
nothing.

## TASK 2 — not computed, and why that is the right answer

The projection the CC-CMD asks for is premised on widening the ambient path from
6 sports to 16. **That widening is not the change the evidence calls for** — the
ambient map is already 11, and the four sports with a resolvable key still get
nothing. Computing a credit cost for a change that does not address the symptom
would be arithmetic in support of a disproven diagnosis.

The limits are recorded for whoever does compute it:
`ODDS_QUOTA_FLOOR = 50` (`index.js:6362`), `_AMBIENT_ODDS_HARD_LIMIT = 85000`,
30/day ambient capture cap, and the capture path charges via
`_consumeAmbientOddsCredit` / `oddsCreditCost` — `ambient-do.js` documents that
the old code charged 1 for a 3-market call and that "two sites cannot disagree
about the price of the same request".

## What IS worth fixing, independent of this symptom

1. **The 16-entry map is duplicated verbatim** in `index.js:6344` and
   `wp-resolver.js:53`. That is the genuine single-source-of-truth defect, and
   Task 1's instinct is right even though its premise is wrong.
2. **`wp-resolver.js:560` indexes it directly** — `ARCHIVE_SPORT_TO_ODDS_KEY[s]`
   — with no lowercasing, while `index.js` always goes through
   `archiveSportToOddsKey()`. The same label resolves in one file and not the
   other. This is latent today and would bite the moment `s` arrives capitalised.
3. **UCL/Europa/Conference are absent from the archive map** — a real gap with a
   measured consequence (6 rows, 0 odds, 2026-09-10).

None of these were done here: 1 and 2 are a refactor whose blast radius covers
every odds call site, and doing them while the actual cause is unknown would put
a structural change on top of an open diagnosis.

## Follow-up, automated

`odds-coverage-census.yml` now runs **daily at 08:17 UTC**, censusing yesterday
and today, committing `outbox/odds-coverage-census.log`. It spends no Odds API
credit. This gap was rediscovered by hand on 2026-08-21 and again on 2026-09-11;
the next change in it should be read from a log rather than re-derived.

## Confidence

- **Findings above: 96.** Every number is measured — the maps parsed at HEAD, the
  blame read from `git log -L`, the census read live and its own instrument
  corrected once when it produced a false zero.
- **That the CC-CMD's fix would fix the symptom: ~40.** Below the floor, so
  Tasks 1–3 were not executed and this is a report.

## Recommended next CC-CMD, in order

1. Run `probe-odds-api.mjs` on a runner with the key. Answers Task 0.4 and tests
   H1/H2 without guessing.
2. Depending on that: either fix the `return`→`continue` starvation, or record
   that the vendor does not serve these markets.
3. Only then reconcile the two duplicate maps and add `ucl`/`europa`/`conference`
   — as a refactor with its own impact analysis, not bundled with a bug fix.
