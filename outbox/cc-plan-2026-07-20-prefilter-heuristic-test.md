# Test Plan — Cheap Pre-Filter Heuristic (field-relay-nba)

## Date
2026-07-20

## Context

Tonight's 8B structural-reframe test (see
`outbox/cc-session-2026-07-20-workers-ai-judge-results.md`) found a narrow,
~200-token wire-copy verb-pattern check achieved **0% false positives** —
its failure mode was 100% false negatives (missed real fails it couldn't
generalize to). That's disqualifying as a full replacement, but not as a
different kind of tool: a fast, free, regex-level pre-filter that only ever
short-circuits toward skipping the Gemini judge call on *obvious* clean
cases — never toward skipping a real fail. Every case the pre-filter doesn't
confidently clear still goes through the existing, proven Gemini judge
exactly as today. This cannot introduce new false negatives on the passing
side by construction, since a low-confidence result always falls through.

**This plan must be executed and all gates passed before any implementation.**

---

## Prerequisites

- Reuse the same 10-brief corpus and Gemini ground truth from tonight's test.
- This is pure regex/string logic — no new binding, no new model, no
  `wrangler.toml` change required.

---

## Step 1 — Design the pre-filter

**Real, critical design constraint, stated up front:** the filter may only
ever output two states — `SKIP_JUDGE` (confidently clean, safe to bypass
Gemini) or `SEND_TO_JUDGE` (default, uncertain — always falls through to the
existing Gemini call). It must never output a "this is a fail" verdict
itself. The filter is a bypass mechanism for obvious passes, not a
replacement judge.

Candidate signal: absence of any wire-copy signature pattern (the verb list
from tonight's 8B reframe test — `has/holds/carries/averages/enters with/
improved to` — directly followed by a bare number) AND absence of any raw
box-score-style construction (name + number + no connecting clause). Confirm
the real, current banned-phrase/pattern list already used elsewhere in
`journalism-quality.js` before inventing a new one — reuse existing patterns
if they already cover this ground.

## Step 2 — Add temporary probe route

`POST /test/prefilter` — takes a real brief, returns `{ skip: boolean,
matchedPattern: string | null }`.

## Step 3 — Corpus test, both directions

Run all 10 real corpus briefs through the pre-filter.

**Real, critical safety check first:** for every real brief where Gemini's
own ground truth is FAIL, confirm the pre-filter returns `SEND_TO_JUDGE`
(never `SKIP_JUDGE`). This must be checked before anything else — if this
fails even once, stop immediately, the filter is unsafe as designed
regardless of any other result.

**Then, real coverage measurement:** for every real brief where Gemini's
ground truth is PASS, record whether the pre-filter returns `SKIP_JUDGE`
(a real, genuine catch) or `SEND_TO_JUDGE` (falls through, no savings on
this one, but no harm either).

---

## Step 4 — Evaluate against gates

### Gate A (hard safety gate) — Zero false skips on real FAIL cases
**Threshold: 0/5 FAIL-case briefs skip the judge.** This is not a percentage
threshold — a single failure here means the design is unsafe and the plan
stops, full stop, regardless of Gate B's result.

### Gate B — Real, meaningful catch rate on PASS cases ≥ 30%
Measures actual, real cost savings potential — what fraction of genuinely
clean briefs can skip the Gemini call entirely. **Threshold: ≥ 30% of real
PASS-case briefs correctly get `SKIP_JUDGE`.** Below this, the real savings
are too marginal to justify the added code path and ongoing maintenance
surface, even though there's no safety risk.

### Gate C — Real, direct latency of the pre-filter itself is negligible
**Threshold: < 5ms per real brief** (pure regex/string ops on already-
generated text — if this isn't trivially fast, something is wrong with the
implementation, not the concept).

---

## Step 5 — Authorization gate

If Gate A passes with zero exceptions AND Gate B clears the 30% threshold,
a separate session is authorized to wire the pre-filter ahead of the
existing Layer 3b judge call in `runQualityChain`, real cost savings
proportional to the real, measured catch rate from Step 4.

**This session does not implement Step 5. It ends at the Step 4 verdict.**

---

## Real, honest note on corpus size

A 10-brief corpus gives a real, directionally useful signal but is a small
sample for a percentage threshold like Gate B — a single brief shifts the
result by 10 points on the PASS-case subset (which is itself only 5 of the
10). If Gate B lands close to the 30% line either way, report this honestly
and recommend a larger, real corpus (30+ briefs) before authorizing Step 5,
rather than treat a borderline result on 5 samples as conclusive.
