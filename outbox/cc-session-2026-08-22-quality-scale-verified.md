# CC session — the 240 bar has never been cleared

**Date:** 2026-08-22 · **Repo:** field-relay-nba · **Branch:** main
**Commits:** `e128a4f` (probe + workflow)
**Closes:** the DONE CONDITION left UNVERIFIED by
`outbox/cc-session-2026-08-16-quality-bar-scale.md`
**Artifact:** `outbox/quality-scale-verify-20260822T234307Z.json`

---

## Why this ran at all

The 2026-08-16 session shipped the derived quality scale and `cleared_196`,
wrote an explicit Rule 90 artifact for verifying them live, and marked the
result **UNVERIFIED** because its sandbox 403s `*.workers.dev`.

It then sat unrun for six days.

`rule-gha-for-sandbox-egress-blocks` is explicit that sandbox egress is not an
acceptable stopping point when a runner has unrestricted egress. The assertions
here are that session's own, verbatim — not re-derived — executed from CI.

---

## The done condition holds

```
PASS  quality_scale present
PASS  reachable_ceiling === 245        (got 245)
PASS  summary rows returned            (47 rows)
PASS  every row carries cleared_196    (all 47 rows)
```

```json
{"nominal_total":300,"reachable_ceiling":245,
 "unreachable_dims":["ctx","matchup"],"unreachable_points":55,
 "flat_bar":240,"flat_bar_pct_of_nominal":80,
 "flat_bar_pct_of_reachable":97.96,"four_fifths_of_reachable":196}
```

Ask 1, ask 2 and ask 3 of that CC-CMD are all live and correct.

---

## The finding: 0 of 523

Over a 7-day window, 523 briefs:

| bar | cleared | rate |
|---|---|---|
| 240 — the documented "excellence" standard | **0** | 0% |
| 196 — `FOUR_FIFTHS_REACHABLE` | 61 | 11.7% |

**No brief has ever cleared 240.** The bar the system calls its standard has not
been met once in a week of production output.

This is not a surprise once the arithmetic is stated, and the 08-16 session
stated it: 55 of the 300 points (`ctx`, `matchup`) are unreachable by
construction in the Worker runtime, so 240 is **97.96% of what a brief can
actually earn**. It is a near-perfect-score requirement wearing an 80% label.

**It also answers the question 08-16 explicitly deferred** — *"is 196 genuinely
discriminating, or practically another unreachable bar?"* At 11.7% it
discriminates. That question is now closed with data rather than left open.

---

## `scoreThreshold: 110` — inert, not wrong

Two relay enqueue sites still pass `110` against a documented standard of 240,
neither carrying a comment either way:

- `src/index.js:8855` — the per-game brief path, which writes **every**
  `game_live_epl_*` and `game_recap_epl_*`. Added `e86e55b`, 2026-06-10 —
  two weeks before the 240 standard existed.
- `src/index.js:7337` — `wc-morning`. Added `354398f`, 2026-07-16.

Measured: EPL game briefs average **141.4** (`epl_match | EPL | 21 briefs`).

So 110 is cleared by essentially everything, by roughly 30 points. **The retry
gate never fires.** It is a fossil doing nothing rather than a fossil doing
damage — which is a materially different finding from the one the code alone
suggests, and the reason this was measured before being touched.

### Why it was NOT changed

Neither obvious alternative is free, and this is a spend decision (Rule 78), not
a config tweak:

- **240** fails every brief. All 523 would exhaust max-retries for zero passes —
  pure LLM cost with no possible success.
- **196** fires retries on ~88% of briefs. Defensible, since it is the derived
  honest bar and it discriminates, but the cost is real and unmeasured.

Recording the judgement rather than making it silently: 110 and 240 are wrong in
opposite directions, 196 is the defensible value, and adopting it needs a cost
estimate first.

---

## Secondary gap found

Every `/quality/report` summary row returns **`n: null`** — the per-row count
column is not populated, so sample sizes are invisible in the response. Totals
here were derived from `below_240` instead (valid only because `above_240` is 0
across every row, so `below_240` is the full population).

Not fixed: out of scope for this probe, and it would change an endpoint contract
(Rule 60/69). Filed here rather than left as a silent workaround.

---

## Integration status

- **VERIFIED:** all four assertions, live, from CI, against the deployed relay.
- **VERIFIED:** the 0-of-523 and 11.7% figures, same response.
- **NOT ASSERTED:** anything about what the threshold *should* be. The probe
  reports the score distribution and explicitly declines the judgement.

Re-runnable any time: dispatch `verify-quality-scale.yml`, or touch
`outbox/.trigger-verify-quality-scale`.

---

## Open, carried forward with criteria (Rule 74)

1. **`scoreThreshold` 110 → 196.** Blocked by: no cost estimate for retrying
   ~88% of briefs. Unblocked by: measuring retry cost per brief against the
   Gemini/Haiku proxy. Verify after: `above_196` rising in `/quality/report`
   without a spend spike.
2. **`n: null` in `/quality/report`.** Its own change, its own commit.
