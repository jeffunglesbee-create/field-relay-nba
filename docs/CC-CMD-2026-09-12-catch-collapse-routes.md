# CC-CMD-2026-09-12 — seven routes answer `ok: true` when the query failed

Second CC-CMD required by Rule 87.4, raised while triaging
`check-absence-collapse.mjs`'s 263 findings.

## What is established

`src/index.js` has seven `.catch(() => ({ results: [] }))` sites. Each turns a
**failed D1 query** into **an empty result set**, and every consumer then reports
that as a successful answer about the data.

| line | what the caller then says |
|---|---|
| 6856 | `{ok:false, skipped:true, reason:'no active postseason series'}` |
| 12148 / 12154 | `{ok:true, games: []}`, HTTP 200 |
| 12283 | `{ok:true, games: []}`, HTTP 200 |
| 12302 | `{ok:true, games: [], count: 0}`, HTTP 200 |
| 13507 | `slateCount = 0` → `divergence = !!kvBrief && slateCount === 0` → offers a repair |
| 13708 | per-sport gap map: every sport shows a gap |

`:6856` is the clearest: the string `'no active postseason series'` is a factual
claim about the postseason, produced by a database error.

`:13507` is the one with consequences beyond reporting — it gates a repair path.
`?repair=true` is required, so it is not automatic, but the divergence signal a
human would act on is fabricated.

Found by reading, not by the matcher: this class was listed FIRST in Rule 99's
own "what the check cannot catch" section (a collapse across a function
boundary). The check has since been taught to see it —
`check-absence-collapse.mjs` now reports `catch-collapse` as its own op — so
these seven are visible in the census, alongside 112 in probe and test
scaffolding where the pattern is harmless.

## Why this is not a one-line fix

Seven different consumers, each needing its own branch, and the right branch
differs:

- A route returning `{ok:true, games:[]}` should return a 5xx or
  `{ok:false, error:'query failed'}` — but changing a response shape is a
  CONTRACTS.md boundary (Rule 60, Rule 86). Check what jubilant-bassoon reads
  before changing any of them.
- `:6856` is inside a cron helper whose return value feeds a summary; it needs
  a distinct `reason`, not a different HTTP status.
- `:13507` needs `divergence` to be three-valued — diverged, not diverged,
  unknown — not a boolean with a fabricated input.

## Tasks

0. **Probe first.** Re-read all seven at HEAD; the line numbers here are from
   2026-09-12 and `src/index.js` moves. Anchor on the `.catch` text, not the
   number. Then grep jubilant-bassoon for each route's consumer and record what
   it does with `ok`, `games` and `count` today.

1. **Decide the shape once, apply it seven times.** A failed query must be
   distinguishable from an empty result by the consumer. Do not invent a second
   convention per route.

2. **Update CONTRACTS.md** for any response shape that changes, and state
   explicitly whether jubilant-bassoon needs a matching change in the same
   session, a follow-up CC-CMD, or is unaffected (Rule 91 SCOPE-LEGIBLE-A,
   radius 3).

3. **Mutate (Rule 90).** For each route, force the query to throw and assert the
   response is now distinguishable from the empty-data case. A test that has
   only seen the happy path has proven nothing.

4. **Done condition.** `node scripts/check-absence-collapse.mjs . --json` reports
   zero `catch-collapse` findings under `src/` that are not suppressed with a
   reason. Commit that output as the artifact (Rule 89).

## Out of scope

- The 112 `catch-collapse` findings in probes, tests and `smoke.js`. A test
  harness swallowing an error into `[]` is a different risk and mostly a correct
  one; do not sweep them in.
- `sw.js:47` in jubilant-bassoon — reviewed, correct (`if (cacheTime && ...)`
  already excludes 0 from the decision), left flagged because suppressing it
  means editing a deploy-trigger path and bumping SW_VERSION in two files for a
  comment.
