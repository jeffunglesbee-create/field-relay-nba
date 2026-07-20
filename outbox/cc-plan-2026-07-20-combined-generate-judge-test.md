# Test Plan — Combined Generate+Judge Prompt (field-relay-nba)

## Date
2026-07-20

## Context

Tonight's investigation confirmed Workers AI cannot replace the Gemini judge
call under current constraints (all 3 candidates fail; see
`outbox/cc-session-2026-07-20-workers-ai-judge-results.md`). The real cost
driver is call *volume*, not Gemini's per-call quality or price — Gemini
itself is fast (~650-850ms) and accurate. This plan tests a different lever:
collapsing the separate generate call and judge call into one combined
prompt, cutting real call count for every clean pass without changing which
model does the judging.

**This plan must be executed and all gates passed before any implementation.**

---

## Prerequisites

- Reuse the existing 10-brief corpus and its Gemini ground truth from
  tonight's test (`/test/gemini-judge` probe route, still live per the prior
  session's own honest cleanup note — confirm it's still present before
  assuming).
- No changes to `runQualityChain`'s public signature. This is a prompt-
  construction change only, isolated to a new probe route.

---

## Step 1 — Construct the combined prompt

Real, direct addition to the existing generation prompt (not `callProxy`
itself): append the real, current `FIELD_VOICE_REGISTER` content and an
explicit instruction — "After writing the brief, self-check it against the
voice rules above. If it violates them, revise the brief until it passes,
then output only the final, passing version. Do not narrate your revision
process."

**Real, important design constraint:** the model must NOT be asked to output
its own PASS/FAIL verdict or reasoning — only the final text. Asking for
visible self-critique risks the same reasoning-budget problem that broke
Gemma 4 tonight, and adds parsing complexity for no benefit (there's nothing
downstream that needs to consume "why it passed").

## Step 2 — Add temporary probe route

`POST /test/combined-generate-judge` — takes the same real generation inputs
`runGenerationPrompt` currently takes (confirm the real, current parameter
shape via probe, don't assume), returns the final brief text and latency.

## Step 3 — Corpus comparison

Reuse the same 10-brief corpus's real *source material* (not the already-
generated briefs — this tests generation, not post-hoc judging). For each of
the 10 real game situations, generate via combined prompt, then run the
output through the existing, proven `/test/gemini-judge` route as an
independent quality check (using Gemini-as-judge here is fine — the model
under test is the combined *generation* prompt, not a new judge).

## Step 4 — Evaluate against gates

### Gate A — Real call count reduction ≥ 40%
Combined approach: 1 call per clean brief (vs. current 2-3). Measure real,
actual average calls per brief across the 10-brief corpus, current
architecture vs. combined. **Threshold: ≥ 40% reduction in average calls
per brief** (accounts for the current circuit breaker already reducing some
volume — the comparison must be against current *post-circuit-breaker*
average, not the pre-fix baseline).

### Gate B — Quality parity: real, blind judge pass rate ≥ 90%
Run all 10 combined-prompt outputs through `/test/gemini-judge`. **Threshold:
≥ 9/10 real PASS** (matching or exceeding the current two-call pipeline's
own real pass rate on the same source material).

### Gate C — Real latency ≤ current two-call total
Measure real, direct latency of the combined call. **Threshold: ≤ the sum of
current generate+judge call latencies for the same brief** (a single longer
call is fine if it's still faster than two sequential ones; a single call
that's *slower* than two combined defeats the purpose).

### Gate D — No regression on FIELD voice signature elements
Spot-check 3 real combined outputs against the same source material's
*current*, real, already-shipped brief (not a hypothetical) for the
subordinated-stats pattern, sentence rhythm, and absence of banned phrases.
**Threshold: no real, direct quality regression a human reviewer would flag**
— this gate is qualitative, report findings honestly rather than force a
numeric pass.

---

## Step 5 — Authorization gate

If all four gates pass, a separate session is authorized to implement
production wiring — folding the voice-register instruction into the real,
existing generation prompt path and removing the separate Layer 3b judge
call for the generation types this was tested against.

**This session does not implement Step 5. It ends at the Step 4 verdict.**

---

## Real, honest risk to flag directly regardless of outcome

Combining generation and self-judgment in one call removes the independent-
reviewer property the current two-call architecture has — a model checking
its own work is a real, different failure mode than a separate pass checking
it (a model can be systematically blind to its own errors in ways a fresh
call wouldn't be). This is worth stating even if Gate B passes numerically —
report it as an open, real consideration for Step 5's own authorization
decision, not just a pass/fail number.
