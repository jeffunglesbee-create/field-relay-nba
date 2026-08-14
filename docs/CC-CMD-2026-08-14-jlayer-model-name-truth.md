# CC-CMD-2026-08-14-jlayer-model-name-truth

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-14-jlayer-model-name-truth.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The finding, already measured — this CC-CMD does not re-litigate it

`CC-CMD-2026-08-14-verify-test-model-override` and the jlayer-model-provenance
pass settled the routing:

- **Gemini 3.1 Flash-Lite is primary. Claude Haiku 4.5 is the fallback.**
- Measured 6/6 across two runner probes: `X-FIELD-Model: gemini-3.1-flash-lite`,
  header present every time, `X-FIELD-Gemini-Error` empty every time.
- `12e4018` made `/test/gemini-judge` report the measured header instead of a
  hardcoded `'gemini-via-proxy'`. Post-deploy artifact:
  `judgeRouteReports: gemini-3.1-flash-lite`, `judgeRouteMatchesReality: true`.

Nothing above is in question. What remains is a **naming** defect that made the
routing unreadable from source, and it is still in place.

## Why CLAUDE.md and the source looked like they contradicted each other

They never did. Both were correct:

- CLAUDE.md: *Gemini 3.1 Flash-Lite primary, Haiku 4.5 fallback.* True.
- Source: 15 call sites send `model: 'claude-haiku-4-5-20251001'`. Also true.

The contradiction is an artefact of the wire format. The proxy speaks the
Anthropic Messages shape, whose field is literally named `model`. In this
proxy's semantics that field means **"the model to fall back to if Gemini
fails"** — the primary is the proxy's choice and is never named by the caller.

So fifteen call sites appear to assert *"we run Haiku"* when they assert
*"if the primary dies, use Haiku."* A reader checking the docs against the code
concludes the docs are stale. That reading cost a session to unwind, and nothing
in the tree currently prevents the next reader repeating it.

This is a borrowed vocabulary leaking wrong semantics into local code. It is not
fixable by editing docs — the misleading token is in the source.

## TASK 0 — probe from HEAD

Enumerate the call sites rather than trusting this document's count of 15.
Record, for each: file, line, and whether it sends the literal
`'claude-haiku-4-5-20251001'` or reads a shared constant.

Also confirm the **one** site that does NOT go through the proxy
(`src/index.js:4846` at time of writing — direct to Anthropic with
`env.ANTHROPIC_API_KEY` and `anthropic-version: 2023-06-01`, in the WC
projections path). That site's `model` field genuinely does name the answering
model, so it must NOT be renamed by this pass. Confirm its line number and,
separately, **whether it is still reachable** — a previous pass found the call
but explicitly did not trace its caller.

## TASK 1 — one named constant, not fifteen literals

Introduce a single constant whose name states what the field means, e.g.

```js
// The Anthropic Messages `model` field, which this proxy reads as the FALLBACK
// target: Gemini 3.1 Flash-Lite is primary and is chosen proxy-side, never by
// the caller. Named for its meaning, not for the wire field it serialises to.
const JOURNALISM_FALLBACK_MODEL = 'claude-haiku-4-5-20251001'
```

Replace the literal at every proxy call site. The wire payload must be
**byte-identical** — this is a naming change, not a behaviour change, and the
done condition below requires proving that.

Do not rename the JSON field itself. It is the Anthropic contract and the proxy
parses it.

## TASK 2 — make the claim checkable rather than inherited

CLAUDE.md's routing claim was true but not confirmable from the repo, which is
the reason it read as suspect. Add, next to the constant, a pointer to the probe
that measures the answering model (`scripts/jlayer-model-probe.mjs`), so the
next reader can re-derive the routing in one command instead of inferring it
from a field name that means something else.

If CLAUDE.md states the routing, extend it with the one sentence that was
missing: **the caller names only the fallback; the primary is chosen by the
proxy and is observable only via `X-FIELD-Model`.**

## TASK 3 — the untested branch, recorded not fixed

The Haiku fallback has **never been observed firing**: 6/6 Gemini,
`X-FIELD-Gemini-Error` empty every time. It carries the entire J-layer when the
primary fails and nothing has demonstrated it works.

Do NOT force a fallback in production to test it. Record in the outbox that the
branch is unexercised, and state what would exercise it. Manufacturing a primary
failure against live journalism is the same error class as generating briefs to
trip a calibration threshold.

## DONE CONDITION

1. Call-site count from TASK 0, with the direct-to-Anthropic site listed
   separately and explicitly excluded.
2. Every proxy call site reads the named constant; zero remaining literals
   (grep output as the artifact).
3. **Byte-identical request bodies** before and after, demonstrated — a diff of
   the serialised payload from one call site, or a test asserting the JSON
   matches the pre-change string exactly.
4. One live call after deploy showing `X-FIELD-Model: gemini-3.1-flash-lite`
   unchanged, so the rename provably did not alter routing.
5. The fallback branch's unexercised status recorded.

## Explicitly NOT in scope

- Do not change routing, model choice, or the proxy.
- Do not rename the `model` JSON field.
- Do not touch `src/index.js:4846`'s direct Anthropic call beyond confirming its
  line number and reachability.
- Do not add a fallback test that makes real calls fail.

## Confidence scoring

- TASK 0 (25 pts): call sites enumerated from source; the direct site identified and its reachability stated
- TASK 1 (30 pts): single constant, all proxy sites converted
- TASK 2 (20 pts): the routing claim is re-derivable from the repo, not inherited
- TASK 3 (10 pts): unexercised fallback recorded, not manufactured
- DONE CONDITION (15 pts): byte-identical payload proven, live routing unchanged

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
Automate follow-ups. No fallbacks, only fixes.

## Outbox

`outbox/cc-session-2026-08-14-jlayer-model-name-truth.md`
