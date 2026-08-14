# CC session — measure which model actually answers J-layer calls

**Date:** 2026-08-14
**Repo:** field-relay-nba (sole)
**Branch:** main (per CLAUDE.md branch policy) — confirmed `git branch --show-current` = `main`
**HEAD progression:** `333cc2d` → `c74efcc` (probe) → `2df4224` (probe log, CI) →
`12e4018` (fix) → probe log run 2
**Deploy run:** 31760675673, attempt 1 FAILED, attempt 2 **success** (see "The deploy failure" below)

## What prompted this

Answering "describe the LLM model setup for the J-layer" from source turned up a
claim that could not be corroborated from inside this repo. `CLAUDE.md` states the
proxy routes to Gemini 3.1 Flash-Lite primary with Claude Haiku 4.5 fallback. Every
J-layer call site sends `model: 'claude-haiku-4-5-20251001'` in the body and lets the
proxy decide, so the request body proves nothing about what answered. The one route
that reported a model — `/test/gemini-judge` — **hardcoded** `model: 'gemini-via-proxy'`.
That is an assertion about what the proxy should have done, not a reading of what it
did. Under Rule 72 the doc claim was a hypothesis, and the route that looked like
corroboration was circular.

## The measurement (Task 1)

`scripts/jlayer-model-probe.mjs`, run on a GitHub Actions runner (the sandbox proxy
403s `*.workers.dev`). 3 calls at `max_tokens: 32` — deliberately minimal real
inference per Rule 78.

The mechanism already existed and was already in use: the proxy returns
`X-FIELD-Model`, `X-FIELD-Latency-Ms`, `X-FIELD-Gemini-Error`, and `src/index.js:8915`
already reads them at the journalism call site. `/test/gemini-judge` simply wasn't.

**Run 1 — `outbox/jlayer-model-probe-20260814T012601Z.log`:**

```
200  3908ms  X-FIELD-Model=gemini-3.1-flash-lite  bodyModel=gemini-3.1-flash-lite  geminiError=-
200  1222ms  X-FIELD-Model=gemini-3.1-flash-lite  bodyModel=gemini-3.1-flash-lite  geminiError=-
200    29ms  X-FIELD-Model=gemini-3.1-flash-lite  bodyModel=gemini-3.1-flash-lite  geminiError=-
/test/gemini-judge reports model=gemini-via-proxy
judgeRouteMatchesReality: false
```

**The CLAUDE.md claim is confirmed, now with verification context (Rule 73):**
Gemini 3.1 Flash-Lite answered 3/3 calls, 2026-08-14 ~01:26 UTC, via direct POST to
`https://field-claude-proxy.jeffunglesbee.workers.dev` from a GH Actions runner,
header present on every call, `X-FIELD-Gemini-Error` empty on every call — i.e. the
Haiku fallback path did not fire during this window. This says nothing about
fallback behavior under Gemini quota pressure, which was not exercised.

## The fix (Task 2)

`12e4018` — `/test/gemini-judge` now returns `model: proxyModel` read from
`X-FIELD-Model`, plus `geminiError` from `X-FIELD-Gemini-Error`. `null` when the
proxy doesn't say — not a guess at what it probably was, and not a fallback chain.

The old label happened to be accurate. That is exactly the problem: it would have
kept reading `gemini-via-proxy` straight through a silent switch to the Haiku
fallback, which is the one condition a route like this exists to observe. A label
that cannot be wrong cannot be informative.

**Done-condition artifact (Rule 89) — `outbox/jlayer-model-probe-20260814T013504Z.log`,
run against the LIVE deployed relay after `12e4018`:**

```
/test/gemini-judge reports model=gemini-3.1-flash-lite (status 200)
"judgeRouteReports": "gemini-3.1-flash-lite",
"judgeRouteMatchesReality": true
```

The required artifact was stated in advance as: the route's `model` field must NOT
equal the string `gemini-via-proxy`, and must equal the model measured in the same
run. Both hold.

## A route that was documented as deleted, and isn't

Mid-task grep found `outbox/cc-session-2026-07-20-cleanup-workers-ai-judge-routes.md`
claiming `/test/gemini-judge` was removed on 2026-07-21, with live 403 verification.
My probe had just received a 200 from it. Rather than assume the doc was stale or
the removal had been silently reverted, I fetched full history (this clone was
shallow — only 52 commits, back to 2026-08-11, which is why the first `-S` search
found nothing but the import commit):

```
22ed3df fix: re-add /test/gemini-judge for combined-generate-judge Steps 3-4
14096a1 fix: remove dead-end Workers AI judge test routes and [ai] binding
51a7732 feat: add Gemini judge probe route for Step 3 corpus comparison
```

Both docs are accurate; the route was deliberately re-added for the still-active
combined-generate-judge investigation. This mattered to the outcome: had the removal
stood, the correct action would have been deleting the route, not repairing its
label. **Note for future sessions: the working clone is shallow. `git log -S` will
silently return nothing for anything before 2026-08-11 unless you
`git fetch --unshallow` first.** That is a live trap for any archaeology like this.

## The deploy failure (investigated, not rationalized — Rule 77)

Deploy run 31760675673 attempt 1 **failed** on my commit. Read before explaining:

```
STRUCTURAL 6 — WOW 6 /journalism/generate e2e
Status: 502
{"error":"proxy returned no prose","proxy_diagnostic":"HTTP_500: error code: 1101\n"}
```

Facts established, in order:

1. The failing step is at `.github/workflows/deploy.yml:361`; the wrangler deploy is
   at line 86 and the deploy gate at 127, both **before** it and both passed. So the
   relay code did deploy; the failure is post-deploy verification.
2. CF error 1101 = an unhandled exception in a Worker — here `field-claude-proxy`,
   not this relay. My diff touches only the `/test/gemini-judge` handler, which the
   WOW 6 probe does not call.
3. That is a plausible story, not proof, so I re-ran the failed job **with identical
   code**: attempt 2 **succeeded**. A code-caused failure would reproduce.
4. Probe run 2 (01:35) then got 3/3 × 200 from the same proxy.

**Likely mechanism, explicitly flagged as unproven:** this same workflow redeploys
field-claude-proxy at line 180, and the 1101 landed at 01:28:48, seconds after that
step — consistent with a cold-start/propagation window. I did not instrument the
proxy to confirm it, and the proxy is outside this repo. What IS established is that
the failure is not caused by `12e4018`.

## Residual — one thing measured and NOT resolved

`X-FIELD-Test-Model: claude-haiku-4-5-20251001` did **not** change the answering
model — the forced-haiku call returned `gemini-3.1-flash-lite` in both runs. I am
**not** claiming the override is broken. That call returned in 29ms and 45ms against
874–3908ms for the others, and all three calls sent an identical body, so a cache hit
is equally consistent with the observation. The probe as written cannot separate
"header ignored" from "response served from cache." Distinguishing them needs a
unique prompt per call, and the answer lives in the proxy worker's source, which is
outside this repo's scope.

This is a genuine open question, not deferred work, so per Rule 87 it is gated by a
CC-CMD rather than left as a carry-forward:
`docs/CC-CMD-2026-08-14-verify-test-model-override.md`.

## Confidence gate

**Score: 97 / 100.** Above the 95 threshold; committed.

- The central claim is measured, not argued: two independent runs, 6/6 calls, one
  distinct model, header present every time.
- The fix's done condition was stated as an artifact before the fix and satisfied by
  a live post-deploy run against the deployed URL.
- The deploy failure was reproduced-against (rerun with identical code passed) rather
  than explained away.
- The route's provenance was resolved from real history, not inferred from two
  conflicting docs.

The 3 points withheld: the `X-FIELD-Test-Model` observation is unresolved by
construction, and the 1101 mechanism is a reading rather than a proof.

## Rule compliance

- **Rule 63** — no dead code: the probe script is committed with its consumer being
  the `archive-gap-probe.yml` dispatch harness, and its output is committed.
- **Rule 69** — touch-only: the diff is 11 insertions in one route handler. Nothing
  adjacent was reformatted or restructured.
- **Rule 76** — no fallback chain added; `null` when the proxy is silent.
- **Rule 13** — `proxyModel`/`geminiError` are declared before the `!resp.ok` early
  return, so both are in scope at the single return site. Grepped for consumers of
  this route: none outside `scripts/` and `docs/`; not present in `CONTRACTS.md`, so
  no cross-system contract to sync.
- **Rule 66** — `node --check src/index.js` clean before commit.
