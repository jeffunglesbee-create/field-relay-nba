# CC session — does X-FIELD-Test-Model actually override the proxy's routing?

**Date:** 2026-08-14
**Repo:** field-relay-nba (sole)
**Branch:** main throughout — confirmed `git branch --show-current` = `main`
**CC-CMD:** `docs/CC-CMD-2026-08-14-verify-test-model-override.md`
**Commits:** `834b7e4` (probe rebuilt), `f78771c` (verdict logic fixed), + this doc's commit
**Dispatch runs:** `archive-gap-probe.yml` × 2 — round 2 (09:13 UTC), round 3 (09:15 UTC)

## Answer

**The override is honored. It is not dead weight — and `gemini-3.5-flash` is broken.**

This is a **fourth outcome the CC-CMD did not enumerate**, and I am reporting it as
such rather than forcing it into A, B, or C. The spec's option set assumed the forced
call would return *some model*; A/B/C all differ only in *which* one. It has no branch
for "the forced call does not return at all." That is a spec defect at authoring time
(and I wrote the spec), not a result to round off.

## PRE-BUILD PROBE — the thing that reframed the task

Grepping the send sites turned up prior work the CC-CMD hadn't accounted for:
`outbox/gemini-model-comparison-2026-07-16.md` records that the proxy validates the
header against `ALLOWED_TEST_MODELS = new Set(['gemini-3.1-flash-lite','gemini-3.5-flash'])`
and falls back to the default when the value is absent **or not in that set**.

Under that claim, round 1's null result had a third explanation beating both of mine:
the override works fine, and round 1 asked it for `claude-haiku-4-5-20251001` — a
Claude model name, not in the allow-list. Treated as a hypothesis to test, not a fact
to write up (Rule 72): it describes a file in a different repo and was 4 weeks old.

That reframing is what made the probe answerable. A probe that only ever sends a
Claude value cannot distinguish "ignored" from "honored but allow-list-scoped" no
matter how many times it runs.

## TASK 1 — Rebuilt the probe (`834b7e4`)

Two changes:

1. **Unique prompt per call** (label + run timestamp in the message text). This was
   the whole reason round 1 was uninterpretable — identical bodies made a cache hit
   and an ignored header fit the data equally well.
2. **Both override arms**: an out-of-allow-list value (Claude) and an in-allow-list
   one (`gemini-3.5-flash`). Only the second discriminates.

## The wrong verdict I shipped, and the fix (`f78771c`)

Round 2 ran and the script printed:

> `VERDICT B — OVERRIDE IGNORED ... The header is dead weight in this repo.`

**That was wrong, and it was wrong in my logic, not in the data.** The discriminating
call had returned **HTTP 500**. The verdict tested `xFieldModel === IN_ALLOWLIST` and
swept every other outcome into "ignored" — conflating:

- *the proxy answered with a different model* → header ignored, and
- *the proxy did not answer at all* → header reached the routing logic and broke it

Those are **opposite conclusions**. An ignored header returns 200 plus the default —
which is exactly what the Claude arm does. A header that throws the worker has
demonstrably taken effect. Had I accepted the printed verdict, this session would
have concluded "dead weight, consider removing the send sites" about a mechanism that
works, and would have missed a live regression entirely.

This is the same failure mode called out repeatedly in this session's history:
**conflating two claims inside one predicate.** The probe was measuring the right
thing and classifying it wrong.

Fixed: non-200 is now its own verdict class and can never be read as "ignored"; the
forced arm repeats 3× **interleaved with unforced controls** so a proxy-wide wobble
can't be misattributed to the header (a 1101 from this same worker had already been
seen hours earlier); and the CF error code is captured instead of truncated away.

## TASK 2 — The measurement (round 3, `outbox/jlayer-model-probe-2026-08-14T09-15-28-239Z.json`)

```
500   978ms  sent=gemini-3.5-flash   X-FIELD-Model=null                   forced-gemini-3.5-1
200  6671ms  sent=(none)             X-FIELD-Model=gemini-3.1-flash-lite  control-1
500  1875ms  sent=gemini-3.5-flash   X-FIELD-Model=null                   forced-gemini-3.5-2
200   839ms  sent=(none)             X-FIELD-Model=gemini-3.1-flash-lite  control-2
500  1013ms  sent=gemini-3.5-flash   X-FIELD-Model=null                   forced-gemini-3.5-3
200  5910ms  sent=(none)             X-FIELD-Model=gemini-3.1-flash-lite  control-3
```

```json
"claudeOverrideHonored": false,
"gotForOutOfAllowlist": "gemini-3.1-flash-lite",
"cacheExcluded": true,
"suspiciouslyFast": [],
"verdict": "A-ERROR"
```

**3/3 against 0/3, interleaved, unique prompts, no implausibly-fast call.**
Deterministic and caused by the header value — not flakiness, and not cache.

Reading it:

- Sending a **Claude** model name → `200`, `gemini-3.1-flash-lite`. Falls through to
  the default. Consistent with the allow-list claim, which is now corroborated over
  the wire rather than inherited.
- Sending **`gemini-3.5-flash`** → `500` every time while controls stay green. The
  proxy took the header, routed on it, and threw.
- Round 1's original puzzle is fully explained: the override was never ignored, it
  was handed a value outside the allow-list.

## What is NOT established

- **The cause of the 500.** The body is a Cloudflare HTML error page (4707 bytes)
  carrying **no** `error code: NNNN` string, so even the CF failure class is unknown.
  `X-FIELD-Gemini-Error` was absent on all three — the proxy's own diagnostic header
  does not populate on this path, which is a second, smaller defect.
- **When it regressed.** `gemini-3.5-flash` demonstrably worked on 2026-07-16 (that
  session scored 5 real briefs from it). Somewhere in 4 weeks it broke. Not bisected.
- **The fix.** It lives in `workers/field-claude-proxy`, which is **not in this
  session's repo scope**. I did not guess at its internals and deliberately did not
  write a relay-side workaround (Rule 64 band-aid, Rule 76 fallback).

## Blast radius — checked, and it is small

**Production is unaffected.** No production path sets `X-FIELD-Test-Model`; the
journalism cron sends no override and got `gemini-3.1-flash-lite` on 9/9 unforced
calls in the same runs. This is a broken *test capability*, not an outage.

Two in-repo consumers do force `gemini-3.5-flash` and cannot work today:
`/debug/gemini-model-test` (`src/index.js` ~8926) and
`scripts/gemini-model-sanity-check.mjs`. Both are annotated in place with the measured
date, the artifact path, and the gating CC-CMD — **not deleted**, since both are real
test infrastructure with prior use, and not worked around.

`CLAUDE.md`'s Journalism Model section now carries the verified routing facts with
Rule 73 context (date, method, conditions), including the explicit warning that the
request body's `model` field says nothing about what answered — only `X-FIELD-Model` does.

## Follow-up (Rule 87 — gated, not carried forward)

`docs/CC-CMD-2026-08-14-gemini-35-flash-route-500.md` — diagnose the proxy-side 500
if that repo is in scope, decide the fate of the two dead consumers, and re-run this
same probe as the done-condition artifact (3/3 `status: 200` with
`model: "gemini-3.5-flash"` and `verdict: A`, or an explicit escalation).

## Confidence gate

**Score: 96 / 100.** Above the 95 threshold; committed.

- The question is answered by measurement with the confound the CC-CMD named
  (cache) excluded by construction and then confirmed excluded in the output.
- The discriminating result is 3/3 vs 0/3 interleaved — not a single sample.
- The wrong verdict was caught by reading the raw call log rather than the summary
  line, and the classification bug that produced it was fixed at the root.
- The in-repo blast radius was enumerated by grep, not assumed.

The 4 points withheld: the cause of the 500 is unknown (CF page with no error code,
proxy repo out of scope), and the regression window is 4 weeks unbisected. Both are
disclosed above and gated, neither is claimed as resolved.

## Rule compliance

- **Rule 77** — the printed `VERDICT B` was investigated, not accepted; it was wrong.
- **Rule 72** — the allow-list claim was tested over the wire, not cited.
- **Rule 64 / 76** — no relay-side compensation for a proxy-side fault; no fallback added.
- **Rule 63** — the two broken consumers annotated rather than left silently dead.
- **Rule 66** — `node --check` clean on all three edited files before commit.
- **Rule 78** — 10 real inferences at `max_tokens: 32`, trivial prompts.
