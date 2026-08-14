# CC-CMD — field-claude-proxy throws on gemini-3.5-flash; two in-repo consumers are dead

**Date:** 2026-08-14
**Repo:** jeffunglesbee-create/field-relay-nba (+ a change that likely belongs in the
proxy worker's repo — see SCOPE)
**Branch:** main — commit directly. No PRs.

```bash
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git log --oneline -5
```

---

## CONTEXT — measured, not suspected

`scripts/jlayer-model-probe.mjs` round 3 (2026-08-14 09:15 UTC,
`outbox/jlayer-model-probe-2026-08-14T09-15-28-239Z.json`) sent
`X-FIELD-Test-Model: gemini-3.5-flash` to field-claude-proxy three times, interleaved
with three unforced control calls:

```
500   978ms  sent=gemini-3.5-flash   X-FIELD-Model=null   forced-gemini-3.5-1
200  6671ms  sent=(none)             X-FIELD-Model=gemini-3.1-flash-lite   control-1
500  1875ms  sent=gemini-3.5-flash   X-FIELD-Model=null   forced-gemini-3.5-2
200   839ms  sent=(none)             X-FIELD-Model=gemini-3.1-flash-lite   control-2
500  1013ms  sent=gemini-3.5-flash   X-FIELD-Model=null   forced-gemini-3.5-3
200  5910ms  sent=(none)             X-FIELD-Model=gemini-3.1-flash-lite   control-3
```

3/3 vs 0/3, interleaved, unique prompt per call. This is deterministic and caused by
the header value, not proxy flakiness. The 500 body is a Cloudflare HTML error page
(4707 bytes), and it carries **no** `error code: NNNN` string — so the specific CF
failure class is currently UNKNOWN, and `X-FIELD-Gemini-Error` was absent on all
three, meaning the proxy's own diagnostic header did not populate for this path.

`gemini-3.5-flash` demonstrably worked on 2026-07-16 — see
`outbox/gemini-model-comparison-2026-07-16.md`, which scored 5 real briefs from it.
So this is a regression somewhere between then and now.

**Production is NOT affected.** No production path sets `X-FIELD-Test-Model`;
the journalism cron sends no override and gets `gemini-3.1-flash-lite`, verified in
the same run. This is a broken test capability, not an outage.

## SCOPE — read this before editing anything

The fault is almost certainly in `workers/field-claude-proxy`, which is **not in this
repo**. Do NOT guess at its internals or write code in this repo that compensates for
it (Rule 64 — a client-side workaround for a proxy bug is a band-aid, and Rule 76 —
do not add a fallback).

If the proxy source is reachable in the session's repo scope, fix it there and
verify with the probe below. If it is NOT reachable, this CC-CMD's deliverable is
TASK 2 only, plus a written escalation — say so plainly rather than inventing a
relay-side patch.

## TASK 1 — Diagnose (only if the proxy repo is in scope)

```bash
grep -rn "ALLOWED_TEST_MODELS\|X-FIELD-Test-Model\|geminiUrl\|DEFAULT_GEMINI_MODEL" \
  workers/field-claude-proxy/src/index.js
```

The 2026-07-16 session recorded `ALLOWED_TEST_MODELS = new Set(['gemini-3.1-flash-lite',
'gemini-3.5-flash'])` and a `geminiUrl(env, key, modelOverride)` helper. Re-read both
at current HEAD — that is a 4-week-old claim about a file this CC-CMD's author never
opened (Rule 72).

Likely candidates, none confirmed: the upstream Gemini model id changed or was
retired; the override path builds a URL that throws; an unhandled rejection escapes
where the default path has a try/catch. **Read the error, don't pick from this list.**

Whatever the cause, the proxy should also populate `X-FIELD-Gemini-Error` on this
path — its absence is a second, smaller defect, since that header exists precisely to
explain failures like this one.

## TASK 2 — Decide what happens to the two dead in-repo consumers

Both force `gemini-3.5-flash` and therefore cannot work today:

- `/debug/gemini-model-test` — `src/index.js` ~8926, its `callModel('gemini-3.5-flash')`
  arm. The route still returns 200 with the default arm populated and the test arm
  showing the error.
- `scripts/gemini-model-sanity-check.mjs` — its only call forces `gemini-3.5-flash`.

If TASK 1 fixed the proxy: leave both alone, and prove they work again (see DONE).

If the proxy is out of scope: do NOT delete them silently. They are live test
infrastructure with a real prior use. Add a one-line comment at each site pointing at
this CC-CMD and the measured date, so the next session doesn't rediscover the 500 from
scratch. That is documentation, not a fallback.

## DONE CONDITION — artifact, not "verified"

Dispatch `archive-gap-probe.yml` with `script=jlayer-model-probe.mjs` and read the
committed `outbox/jlayer-model-probe-*.log`. Exactly one of:

- **Fixed:** `inAllowlistResults` shows 3/3 `status: 200` with
  `model: "gemini-3.5-flash"`, and the summary `verdict` is `A` (not `A-ERROR`).
  Quote those three lines in the outbox doc.
- **Not fixed, escalated:** `verdict` remains `A-ERROR` with 3/3 500s against 3/3
  control 200s, AND the outbox doc names who/what owns the proxy worker and states
  that the relay-side consumers were annotated per TASK 2.

A run whose controls are not all 200 proves nothing either way — the probe reports
`verdict: C` for that case. Re-run rather than reporting it.

## TASK 3 — Outbox manifest

`outbox/cc-session-2026-08-14-gemini-35-flash-500.md`: commit hash, dispatch run id,
the quoted done-condition lines, which branch of DONE, and a confidence gate.
