# CC session — the odds ledger was blind to most of what it spends

Date: 2026-09-05
Session: https://claude.ai/code/session_017FXC1oRxRstzY2xGJBFu2k
HEAD progression: `6265807` → `3d62a33` → `cf00d34` → `024bdff`
Deploys: 891 (success), 892 (success), 893 (success)

## What started it

A probe answered a different question than the one asked. `/budget/odds` was
built to check whether Odds API quota blocks the client's win-probability chart.
It does not — 76,456 credits remained. But the same response showed the provider
reporting **23,544 credits used where our own counter reported 5,749**, and that
gap was the real finding.

## Root cause: five sites, and the ledger saw none of them

`ODDS_HARD_LIMIT` (85,000) exists to prevent a repeat of the June 2026 wipeout,
where two uncached fetch helpers burned 19,999 of 20,000 credits in one session.
It reads a KV counter that five spending paths never touched.

| site | file | what it was |
|---|---|---|
| `getWCPregameLambdas` | `src/index.js` | live WP path, charged nothing |
| `handleWCOddsProbs` | `src/index.js` | public route, charged nothing |
| `handleCFLOddsProbs` | `src/index.js` | public route, charged nothing |
| `_captureClosingOdds` | `src/ambient-do.js` | daily layer only, and 1 for a 3-market call |
| **the `/odds/*` proxy** | `src/index.js` | **publicly reachable, charged nothing** |

**The proxy is the one that matters.** `ODDS_ALLOWED_PREFIXES` admits
`/v4/sports/`, so `/odds/v4/sports/{key}/odds?markets=…` forwards to the
provider with our key attached, from anyone, uncounted. The 1h edge cache bounds
burn per *distinct query string*, which is not a bound when `markets=` and
`regions=` vary freely. It is the only one of the five reachable without our own
code deciding to call it.

**`_captureClosingOdds` is the one worth naming separately.** It *did* call a
guard — just `checkAndIncrementDailyOdds`, the daily-only one. Every grep for
"is this site guarded" answered yes. That is why the gate now checks *which*
guard, not whether one is called. A grep is not a gate.

I found the proxy last, while writing the gate — not by reading the four I
already knew about. The gate found a hole its author had missed, before it ever
ran in CI.

## Second defect: every `us,eu` call was charged half

`oddsCreditCost(url)` shipped with a markets-only model, because that is what
this repository's own two guarded sites already asserted in their comments
(3 markets → 3, historical → 10×) and nothing here had ever mentioned a regions
factor. Whether `regions` also multiplies was left **explicitly unverified**
rather than guessed — `ODDS_REGIONS_MULTIPLY = false`, one line to flip, with
the instrument to settle it wired in the same commit.

Measured 2026-09-05T01:59:12Z (`outbox/odds-cost-model-probe-2026-09-05T01-59-10.json`):
`/cfl/odds-probs` returned `X-Requests-Last: 6` for 3 markets over `regions=us,eu`.
Corroborated independently — `X-Requests-Remaining` fell exactly 6 across the
two calls (76381 → 76375), so 6 was that call's price and not concurrent traffic.

Regions multiply. What moved, and what did not:

| site | regions | charge |
|---|---|---|
| `getWCPregameLambdas` | us,eu | 2 → 4 |
| `/wc/odds-probs` | us,eu | 2 → 4 |
| `/cfl/odds-probs` | us,eu | 3 → **6**, the measured number exactly |
| AmbientDO live poll | us,eu | 1 → 2 |
| `fetchSportOddsLive` | us | 3, unchanged |
| `fetchSportOddsHistorical` | us | 30, unchanged |
| `_captureClosingOdds` | us | 3, unchanged |

Everything that moved sends `us,eu`; everything that did not sends `us` alone.
That split is the check that the finding was applied correctly rather than
broadly, and it explains why the factor stayed invisible: both long-guarded
sites are single-region, so nothing in this repo ever had cause to notice.

## What now blocks it going blind again

`scripts/check-odds-calls-guarded.mjs`, blocking in `deploy.yml`. Nine call
sites found and accounted, plus the proxy checked **structurally** — the proxy
builds its target through `oddsUrl(cleanPath, …)`, so no regex over this source
can ever match a URL there, and a gate reporting "9 of 9 accounted" while the
one publicly reachable billable route stood open would be asserting something
false. A count ratchet makes a new site visible even when correctly guarded.

Proven by mutation, all four checks:

| mutation | caught |
|---|---|
| remove a guard from `getWCPregameLambdas` | yes |
| downgrade a guard to the daily-only call (the real defect) | yes |
| hardcode a cost back to `3` | yes |
| unguard the public `/odds/*` proxy | yes |

9 scanner self-tests. 8 cost-model tests against the real exported function,
imported rather than copied.

## My own defects, and what caught each

| defect | caught by |
|---|---|
| `BILLED` regex required a `${template}` sport key, so it saw none of the three literal-key sites that are the reason the file exists | the gate's own count (7 found, not 9) |
| guard window read only lines ABOVE the call — fails for every site that declares the URL const first, which is the shape the fix itself introduces | the `guarded and derived passes` self-test |
| first draft rebuilt the ambient URL inline for the cost while `buildUrl` stayed put — two strings that must agree, the copy-of-the-source defect | reading the diff |
| the verdict called the first real run `neither`, which was true and useless | the run itself |
| push retry loop burned 5 attempts on a non-fast-forward, which is not a network error | the loop's own output |

## The probe learned something about itself

`/wc/odds-probs` returned `cost: "0"` and the verdict came back `neither` —
literally true and telling nobody anything. The World Cup has no listed events
today, and a call returning no events bills nothing. **One route measured the
model cleanly and the other measured nothing, and the function threw away the
half that worked.**

Zero-cost routes are now set aside as non-readings, named in the verdict rather
than silently dropped, and the model is decided on whatever actually billed. If
nothing bills, the state is `unresolved` and says to re-run in season — the
probe reports that it did not measure, instead of reporting absence of evidence
as a model. `probs` is recorded per route so a zero explains itself.

It also stopped restating what it expects the code to say: it imports
`ODDS_REGIONS_MULTIPLY` from the shipped module and compares the provider
against the **deployed** model, so it stays a check after the constant changes
rather than needing to be edited alongside it. 12 verdict cases pass offline
against the real function text, including the exact shape of the first real run.

## Verified end-to-end vs staged

VERIFIED:
- Gate passes at HEAD and fails on all four mutations (local, and in deploy 892/893).
- Deploys 892 and 893 green, including the new blocking gate step.
- Regions factor measured from the provider's own header, corroborated by the
  remaining-delta.
- Client compatibility read from source: `fetchCFLOddsProbs` in
  `jubilant-bassoon/src/legacy/field.js` returns its cache on `!r.ok`, so the new
  503/429 refusals degrade to last-known. `cost`/`charged`/`guarded` are additive.

STAGED — one item, with unblock criteria (Rule 74):
- **Whether the provider's counter window is the calendar month.** Five unguarded
  sites plus a 2× undercount on every `us,eu` call explain most of 23,544 vs
  5,749; a billing period that does not start on the 1st would explain the rest.
  *Blocked by:* nothing spendable — it needs elapsed time, not a call.
  *Unblocked when:* several days of `/budget/odds` readings exist.
  *Verify:* dispatch `odds-quota-probe.yml` on 2026-09-08 and compare the
  provider's `requests_used` delta against our monthly counter's delta over the
  same interval. Equal deltas mean the windows agree and the remaining gap is
  historical; unequal means the window differs.

## Carry-forwards

None. The one open question above is STAGED with its unblock criteria and costs
nothing to answer.

## Not changed, deliberately

- `handleWCOddsProbs` injects a hardcoded Germany v Ecuador odds entry
  (`src/index.js`, "market consensus from screenshot data", dated 2026-06-25).
  Fabricated market data in a response is a Rule 2 concern and it is out of this
  change's scope (Rule 69). Recorded here rather than touched.
- `ODDS_ALLOWED_EXACT` still lists `/v4/usage`, which the provider 404s. Now
  harmless — nothing calls it and `oddsBillablePath` exempts it — but it remains
  an allow-list entry for a path that does not exist.
