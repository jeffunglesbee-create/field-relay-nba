# Decision — the body layer is retired as a target

**Date:** 2026-09-05 · **Status:** RETIRED, measured not chased
**Evidence:** `outbox/provenance-census-latest.json`, `outbox/provenance-runtime-probe-latest.json`

## The target being retired

"Every response should carry its own provenance in its body." The census scored
this **6 of 186** and the number sat in status reports as an open gap for most of
the session.

## Why it is not worth doing

Four reasons, each measured rather than argued.

**1. The client never sees a relay body field.** `jubilant-bassoon`'s `setCached`
stores an assembled `sections` structure, not the relay payload
(`src/legacy/field.js:3084`). A field added to a relay response is transformed
away before anything persists it. 132 edits, no reader.

**2. The relay's own caches already carry it.** Since `a416241`, every KV write
records `_src` and `_at` in metadata, and since `e35a703` every read surfaces the
oldest of them as `X-FIELD-Data-Age-Seconds`. The case the body layer was for —
a cached payload whose age is invisible — is covered, in the place the value
actually lives.

**3. 24 routes have no body of ours at all.** The passthrough routes forward
upstream bytes. There is nothing to add a field to without rewriting someone
else's payload, which is a worse idea than the problem.

**4. The same facts already travel with every response.** 186 of 186 carry
route, kind, source, served-at, manifest version and data age. Verified against
the deployed worker, not inferred from source.

## The argument that kept it open, and why it does not hold

*"A header is lost the moment a response is saved to a file, logged, cached or
piped into a script; a body keeps its provenance."*

True in general, and it does not apply here. The three places a response is
persisted in this system are the client (which transforms first), the relay's own
KV (metadata, covered), and this repo's probe artifacts (which stamp their own
`checked_at`). No fourth consumer was found.

## What changes

- The census headline is now the **effective** layer — what a caller receives.
  The body layer is still counted, because the number is real and free, under a
  label that says it is retired.
- **The old labels were the sharper reason.** `none` read *"a value with no
  visible origin"*. That was true when the census was written and became false
  the day the response wrapper shipped: those 130 routes all carry
  `X-FIELD-Source`. An instrument whose labels outlive the state they describe is
  the exact defect this exercise exists to catch, so they now describe only what
  they check — the body, and nothing else.
- No gate is added. Retiring a target does not need enforcement; it needs the
  number to stop reading as a backlog.

## What would reopen it

A consumer that persists a relay response **verbatim** and later needs its
origin. None exists today. If one appears, it needs body-level provenance on the
routes it consumes — not on all 186.
