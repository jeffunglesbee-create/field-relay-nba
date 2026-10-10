# CC session — measure four BSD premises before building on any

**Date:** 2026-10-10
**Repo:** field-relay-nba, branch `main`
**Spec:** `docs/CC-CMD-2026-10-10-bsd-measure-before-building.md`
**Type:** A (probe). **No feature shipped.** One artifact.
**Budget:** declared 40 calls, **used 16**, budget not hit, nothing left unmeasured.

Artifact: `outbox/bsd-surface-probe-latest.json`.

States sampled: pre-match `220230` (`notstarted`), live `207856`
(`inprogress` / `2nd_half`), finished `223324`.

## Task 1 — the free-odds substitution is NOT viable

The CC-CMD's suspicion was right and its hedge was also right, in different
directions. The 10-03 thin result WAS partly an artifact of sampling a finished
match — but fixing that does not rescue the premise.

BSD's market keys, **verbatim**:

| state | keys |
|---|---|
| pre-match | `asian_handicap`, `btts`, `draw_no_bet` |
| live | `1x2`, `asian_handicap`, `btts`, `double_chance`, `draw_no_bet`, `over_under_05`, `over_under_15`, `over_under_25`, `over_under_35`, `total_corners` |

| family | pre-match | live |
|---|---|---|
| moneyline | **no** | yes (`1x2`) |
| spread | yes (`asian_handicap`) | yes (`asian_handicap`) |
| total | **no** | yes (`over_under_*`) |
| opening price | **no** | **no** |

Verdict, pre-match: `sufficient only for a subset (spread)`.
Verdict, live: `sufficient only for a subset (moneyline, spread, total)`.

**Done condition 2, in the document's words: the free-odds substitution is NOT
viable.** Judged on pre-match, because that is the product the docs describe
and the state at which a model needs a price. No opening price exists at any
state, and the model needs one.

## Task 2 — `/api/v2/teams/{id}/form/` serves a real shape, and it carries xG

HTTP 200. Top-level keys **verbatim**:

```
team_id, team_name, requested, matches, league_id, from_date, to_date,
overall, home, away, vs_stronger, vs_weaker
```

- **Window:** explicit — `requested`, `matches`, `from_date`, `to_date`. The
  endpoint states its own window rather than leaving it to be inferred.
- **xG:** present.
- **Per-competition:** `league_id` is on the payload, so it is scoped to a
  competition, not all-competitions. That was the question that decides whether
  it can feed a league-position forecast, and the answer is yes.
- Splits by `overall` / `home` / `away` / `vs_stronger` / `vs_weaker`.

This is the input `field-laboratory`'s EPL forecaster does not have. Its
`METHOD = "table-v1: ppg + 0.25*gdpg + 0.10*gfpg, home +0.30"` exists because
no better input was reachable. One is.

## Task 3 — NBA yes, NHL no

Basketball, **7 leagues verbatim**: `NBA`, `Euroleague`, `Liga ACB`,
`Lega A Basket`, `Germany BBL`, `Eurocup`, `WNBA`.

Hockey, **13 leagues verbatim**: `DEL`, `Elite A`, `Extraliga`,
`HockeyAllsvenskan`, `ICE Hockey League`, `KHL`, `Liiga`,
`National League A`, `SHL`, `Spengler Cup`, `Tipsport Liga`,
`U20 World Championship`, `World League`.

**NBA and WNBA are present. NHL is absent.** So the cost argument extends to
basketball and not to hockey — except that Task 1 killed the cost argument
anyway, which is the right order to have learned it in.

## Task 4 — lineups distinguish predicted from confirmed; broadcasts are territory-scoped

`lineup_status` at three states, which is the question that took three and a
half months to answer for `average_positions`:

| state | `lineup_status` | `beta` |
|---|---|---|
| pre-match (`notstarted`) | **`predicted`** | `true` |
| live (`2nd_half`) | **`confirmed`** | `false` |
| finished | **`confirmed`** | `false` |

The vendor does distinguish them, and `beta` tracks it exactly. A predicted
lineup an hour before kickoff and a confirmed one at kickoff are different
products, and both are available.

Top-level keys verbatim, identical at all three states: `event_id`,
`lineup_status`, `beta`, `lineups`, `unavailable_players`, `updated_at`.

**Broadcasts ARE territory-scoped** — `country_code` is on every row. Full row
keys verbatim: `id`, `event_id`, `home_team_id`, `home_team`, `away_team_id`,
`away_team`, `league_id`, `league_name`, `event_date`, `country_code`,
`channel_id`, `channel_name`, `channel_link`, `scheduled_start_time`.

A channel list with no territory would have been worse than none. This one has
one.

## Task 5 — no rate-limit header exists, and that is the finding

Across 16 calls, **not one `x-ratelimit*` or `retry-after` header was
returned.** The only cache-adjacent headers seen were `x-cache-status: MISS`
and `cf-cache-status: DYNAMIC`.

So the limits remain unmeasured from responses. `bsd-newsletter-claims`
reported `rateLimit: {}` and this run explains why: there is nothing to
capture. The docs' "Conventions & limits" is a claim, not a measurement, and
nothing in the response stream will corroborate it.

## Three defects in my own measuring apparatus

All three were in the analysis, not the product, and all three were caught by
reading the output rather than the code.

1. **A two-letter needle.** The totals matcher included `'ou'`, which
   false-matched `double_chance` — d-o-**u**-ble — and reported a
   double-chance market as a goals total. It was visible only because the
   matcher records `matchedKeys` rather than a bare boolean. Removed.
2. **The verdict merged pre-match and live keys into one answer**, which reads
   as "mostly there" and is wrong about the state that matters. Now per state —
   and the per-state split IS the finding, since pre-match lacks exactly what
   live has.

3. **A cache header answering a question about rate limits.** `RATE_HEADERS`
   included `x-cache-status` and `cf-cache-status`, so on a run that saw ZERO
   rate-limit headers the artifact read *"rate-limit headers observed:
   {x-cache-status: MISS, cf-cache-status: DYNAMIC}"* — the exact substitution
   this CC-CMD exists to stop, committed into the artifact that was supposed to
   stop it. Separated; the finding now states the absence and reports the cache
   headers beside it, labelled as not answering the question.

All three recomputed from the recorded values. **No new calls were spent**;
`callsMade` stays 16. The timestamped artifact holds the as-run values; the
`-latest` copy carries the corrected verdict with a `recomputed` block stating
why it differs.

## And the import guard I wrote this morning did not work

`import.meta.url.endsWith(basename)` — with `node -e` the entry argv is empty,
`''.endsWith('')` is true, and the module ran on import anyway, defeating the
guard's whole purpose. It would also have fired for a same-named file in
another directory. Replaced with `pathToFileURL(process.argv[1]).href` in both
probes, and proved inert by importing each and observing nothing run.

## Carry-forwards

**None.** Four CC-CMDs can now be written against numbers:

1. **Odds substitution — do not write it.** Measured not viable.
2. **`teams/{id}/form/` into the EPL forecaster** — xG present, window stated,
   competition-scoped.
3. **Predicted lineups** — `lineup_status: predicted` with `beta: true`
   pre-match is a real product surface.
4. **Broadcasts** — territory-scoped via `country_code`, so a US-filtered
   stream list is buildable.
