# Claude Code Command — Build relayOperation() for field-relay-nba, the relay-side analog of jubilant-bassoon's fieldOperation()

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** ADD new code only, in `src/index.js` and `src/game-do.js`. Zero existing call sites touched. Separate runtime from jubilant-bassoon's `fieldOperation()` (single-file client vs. Worker), so this is its own primitive, not a shared import — but should match the same `{ok, code, subsystem, operation, retryable, context}` shape for consistency across the two repos.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read CLAUDE.md and STANDARDS.md Rule 69 (TOUCH-ONLY-A) and Rule 47 (RELAY-CPU-A — this primitive is plumbing/telemetry, not editorial intelligence; confirm nothing built here computes a composite interest/drama value, only records success/failure of operations that already happen) before touching this file.

Write findings to outbox/cc-relay-operation-primitive-2026-07-12.md.

## CONTEXT — grounded in real patterns confirmed this session, not the jubilant-bassoon proposal alone

Confirmed via direct grep of current `src/index.js`: 59 `return null;`, 115 silent-swallow `catch` blocks, 12 fire-and-forget `.catch(() => {})` calls. No existing `FIELD_OPERATIONS`-equivalent primitive here.

Two real, already-investigated examples from this exact session make the case concretely, not hypothetically:

1. **GameDO's fire-and-forget POSTs** (`game-do.js`, the `/archive/game` and `/journalism/game-complete` calls inside `_poll()`): both correctly use `.catch(() => {})` because a DO's primary fan-out function must never be blocked by a downstream archival/journalism failure (CLAUDE.md Rule 5). That's the right behavior to keep. But right now a failure here is completely invisible — nothing records that it happened. `relayOperation()` should let this stay fire-and-forget for the *caller* while still recording the failure for observability, the same differentiated pattern jubilant-bassoon's Chunk 1 doc names for its own swallowed cases.

2. **The completion-trigger source-mislabeling bug fixed earlier this session**: a typed result with an explicit `source` field passed through consistently would have made that entire multi-hour investigation (three separate CC-CMDs) either unnecessary or far faster — the ambiguity was exactly "did this succeed, and if so, via which path" collapsing into an untyped, unlabeled write.

## TASK 0 — Probe

```bash
grep -n "return null;" src/index.js | wc -l
grep -cE "\.catch\(\s*\(?_?\)?\s*=>\s*\{" src/index.js
grep -cE "catch\s*\([^)]*\)\s*\{\s*(/\*.*\*/\s*)?\}" src/index.js
```

Re-confirm current counts, do not trust the 59/12/115 above without checking — time has passed since this doc was written.

## TASK 1 — Add the primitive, matching jubilant-bassoon's shape

```javascript
const RELAY_OPERATIONS = {
  recordFailure(failure) {
    // Minimal for now: console.error with structured fields (Workers logs
    // are the closest equivalent to the client's window._fieldErrors /
    // Health Panel — there is no existing relay-side telemetry store to
    // extend, unlike jubilant-bassoon's captureFieldError(). Confirm this
    // via TASK 0 before assuming it — if one exists and this doc missed
    // it, extend that instead of adding a second one, same principle as
    // the client-side CC-CMD.
    console.error(JSON.stringify({ type: 'relay_operation_failure', ...failure }));
  },
};

async function relayOperation({ subsystem, operation, retryable = false, context = {}, swallow = false }, fn) {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    const failure = { subsystem, operation, retryable, context, error: error?.message || String(error), at: Date.now() };
    RELAY_OPERATIONS.recordFailure(failure);
    if (swallow) return { ok: false, ...failure }; // caller opted into fire-and-forget; still returns the typed result for the rare caller that does check it
    return { ok: false, ...failure };
  }
}
```

The `swallow` param is documentation, not different logic — `relayOperation()` always returns the typed result either way; `swallow: true` is a marker at call sites (like GameDO's archive/journalism POSTs) that the caller is *choosing* not to await/check it, matching Rule 5's fire-and-forget requirement, while still making the failure observable. Do not build two different code paths for this — one function, one behavior, a documentation flag.

## TASK 2 — Verification

- Unit-level: call with a succeeding and a throwing `fn`, confirm both return shapes.
- Confirm zero existing call sites changed via `git diff`.
- `node --check src/index.js` and `node --check src/game-do.js`.
- Write outbox manifest per Rule 87.

## DONE CONDITION

`relayOperation()`/`RELAY_OPERATIONS` exist, unit-verified, shape-consistent with jubilant-bassoon's `fieldOperation()`. Zero existing call sites modified — migrating GameDO's own two fire-and-forget calls (the motivating example) is explicitly deferred to its own, separate, single-concern CC-CMD, not bundled here.

**Confidence scoring:**
- TASK 0 re-confirms real current counts, checks for an existing telemetry store before adding a new one (20 pts)
- `relayOperation()` shape-consistent with the client-side primitive (25 pts)
- `swallow` correctly documented as a marker, not a second code path (20 pts)
- Zero existing call sites touched, confirmed via diff (20 pts)
- Both `node --check` clean, unit-level proof of both paths (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
