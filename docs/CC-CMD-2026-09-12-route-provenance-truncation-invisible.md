# CC-CMD-2026-09-12 — a truncated route parse is indistinguishable from a complete one

**STATUS: CLOSED 2026-09-13** (`5fa598d`). Tasks 0, 1, 3, 4 done. **Task 2
answered WONTDO on evidence** and its root cause filed as
`CC-CMD-2026-09-13-route-scan-brace-balance-defeated.md`.

- **Task 0:** 2 of 225 routes truncate — `/archive/` and `/mcp`. This document
  said not to assume `/archive/` was the only one; `/mcp` is the second.
- **Task 1:** the flag is carried through the merge and emitted as `t: 1`,
  sticky across merges. The builder prints the partial reads **by name** beside
  the count.
- **Task 4 gate:** `check-route-provenance.mjs` re-derives truncation from the
  scanner rather than trusting the committed file —
  `ok every partial read says so (scanner 2, manifest 2, of 189 entries)`.
- **Task 3:** four mutations breaking the set / carry / emit wiring at each
  point, plus a forced truncation at `WINDOW=200`. All caught.

**Task 2 — raising `WINDOW` is strictly worse, measured:** 1500 → 2 truncated,
3000 → 1, 6000 → 1, 12000 → 0. But at 12000 `/archive/` claims **50 hosts** —
ATP, WHOOP, Dropbox, Wikimedia, Bundesliga, every upstream in the worker — and
loses its `t: 1`. Under-reporting-and-flagged becomes
over-reporting-and-confident, on a value stamped onto live responses. This
document predicted the shape (*"changes which routes are wrong without making
any of them say so"*); the measurement is worse than the prediction.

Session doc: `outbox/cc-session-2026-09-13-route-provenance-truncation.md`.

---

Rule 87.4 successor, raised while regenerating the route-provenance manifest
after `CC-CMD-2026-09-12-catch-collapse-routes`.

## The finding

`scripts/lib/route-scan.mjs` `bodyOf()` scans forward at most `WINDOW = 1500`
lines for brace balance. When it does not balance it returns:

```js
{ text: <the whole 1500-line window>, via: 'inline', resolved: true, truncated: true }
```

The `truncated` flag is correct and deliberate — its own comment says *"An
unbalanced block must say it did not parse, not hand back an empty answer that
reads as fact."* **But nothing downstream reads the flag.**
`build-route-provenance.mjs` treats a truncated body exactly like a complete
one, so `src/route-provenance.js` records a truncated parse and a real one in
the identical shape. This is Rule 99 (DISTINGUISHABILITY-A) inside the
provenance instrument itself.

## Measured 2026-09-12

`/archive/` is the live case. Dispatch at `src/index.js:11858`, block never
balances, window ends at 13358.

`/cfl/odds-probs` is declared at 13349 and `/cfl/` at 13358 — **inside that
window by nine lines.** So `/archive/`'s declared sources included
`echo.pims.cfl.ca` and `www.cfl.ca`, which `/archive/*` does not fetch.

Adding ~40 lines to `src/index.js` for the catch-collapse fix pushed the CFL
routes past 13358, and the regenerated manifest silently dropped both hosts:

```
-  "/archive/": { ... s: "... + echo.pims.cfl.ca + ... + www.cfl.ca", p: 1 },
+  "/archive/": { ... s: "... (no cfl hosts)", p: 1 },
```

**Neither value is a fact about `/archive/`.** Both are artifacts of where an
arbitrary 1500-line boundary happened to land. The entry will churn on any edit
in that region, and the churn looks like a real provenance change in review.

## Tasks

0. **Probe.** List every route whose `bodyOf` returns `truncated: true` at HEAD.
   `/archive/` is one; do not assume it is the only one. Print the count with
   its denominator (Rule 91).

1. **Carry the flag into the manifest.** A truncated entry must be
   distinguishable from a parsed one — a field, not a comment. Callers that
   report provenance must be able to say "this route's sources are a partial
   read", because that is what they are.

2. **Then decide about the window.** Raising `WINDOW` is the obvious move and is
   the wrong first step: it changes which routes are wrong without making any of
   them say so. Do task 1 first so task 2's effect is measurable.

3. **Mutate (Rule 90).** Force a route to truncate and assert the manifest entry
   says so. A flag that has never been observed in the output has not been shown
   to reach it — which is exactly the defect being fixed.

4. **Done condition.** `check-route-provenance.mjs` fails if any manifest entry
   is derived from a truncated parse and does not say so. Commit that output.

## Note

The regenerated manifest was committed as-is rather than held, because
`check-route-provenance.mjs` blocks the deploy on staleness and the stale
manifest was not more correct than the fresh one — only differently wrong. That
is recorded here so a future reader does not read the `cfl.ca` removal as a
deliberate provenance correction.
