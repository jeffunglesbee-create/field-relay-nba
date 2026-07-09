# CC-CMD: Remove the maxRetries:6 override still bypassing the starvation fix

**Date:** 2026-07-09
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

Found during TASK 1 of the threshold-240 migration: `/journalism/generate`'s
`runQualityChain` call passes `maxRetries: 6` explicitly — a literal,
truthy value that bypasses `opts.maxRetries || 7` entirely (the fallback
only applies when the caller passes nothing). This means the exact
starvation bug fixed yesterday (CC-CMD-2026-07-08-jq-3b-starvation-and-
targeting, 100/100, verified via a real test showing all 7 layers firing)
is still live on this specific endpoint — the one most likely to matter,
since it's the live, on-demand, user-facing path, not a background cron.

**Why this is likely a leftover, not a deliberate choice:** no comment
explains the `6` — and this codebase's own established convention
(visible throughout `journalism-quality.js` and confirmed again in
yesterday's own threshold-comment fix) is to explain every deliberate
threshold/retry choice with a comment. The absence of one here is the
same evidentiary signal that correctly identified the 130 threshold as
a fossil, not a design decision. Most likely explanation: this value was
set before yesterday's fix existed, when 6 genuinely was the global
default, and was never revisited when the default moved to 7.

**This CC-CMD does not stop at the one instance already found.** Fixing
only the one call site discovered by chance would repeat the exact
mistake that created this gap in the first place — yesterday's fix
changed the default without checking whether any existing call site
already passed an explicit override. Sweep all `runQualityChain(` call
sites (10 confirmed to exist as of last night's investigation) for any
explicit `maxRetries:` value, not just this one.

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "runQualityChain(" src/index.js
# Re-enumerate every call site — 10 expected, but re-confirm rather than
# trust last night's count, code changes fast in this file.

grep -n "maxRetries:" src/index.js
# Find every explicit maxRetries override across ALL call sites, not
# just the /journalism/generate one already known. This is the actual
# point of this CC-CMD — report every hit found, not just the expected one.

grep -n "opts.maxRetries || 7" src/journalism-quality.js
# Re-confirm the default is still 7 before assuming what "correct"
# means here.
```

## TASK 1 — Remove every stale explicit maxRetries override found

For each `runQualityChain(...)` call site the probe finds passing an
explicit `maxRetries` value below 7: remove that line entirely, letting
it inherit the shared `|| 7` default — do not change it to a different
explicit number, removal is the fix, so this endpoint stays in sync
with the default automatically if it's ever revisited again rather than
needing to be found and fixed a third time.

**If the probe finds a call site passing `maxRetries` at 7 or above
explicitly:** leave it alone — that's not the bug, only values below 7
recreate the starvation risk.

**If the probe finds zero additional instances beyond the one already
known:** state that explicitly in the outbox as a real, checked finding
("swept all N call sites, found exactly one, now fixed") rather than
silently assuming it based on last night's incomplete-in-hindsight scan.

## TASK 2 — Live verification via the actual HTTP endpoint, not just the function

Yesterday's test proved `runQualityChain` itself works correctly with
maxRetries=7 — it did not prove this specific endpoint's call actually
uses that path, since the endpoint was silently overriding it the whole
time. That gap is exactly what let this slip through. Close it properly
this time: construct a real POST to `/journalism/generate` (not a direct
function call) with a draft/context combination designed to trip all six
structural layers, and confirm via response or logging that
`layers_fired` includes `3b` and that seven retries were available — the
actual live path, not the underlying function in isolation.

## DONE CONDITIONS

- [x] All `runQualityChain` call sites swept for explicit `maxRetries`
      values, every hit reported (even if the count is exactly one)
- [x] Every instance below 7 fixed by removal, not by hardcoding a new number
- [x] Live HTTP test against the actual `/journalism/generate` endpoint
      (not a direct function call) confirms layer 3b fires there specifically

## CONFIDENCE SCORING

- +30 — full sweep performed and reported honestly, not assumed from
  last night's partial scan
- +30 — every found instance fixed by removal, none left as a hardcoded
  replacement number
- +40 — live HTTP-level test (not function-level) proves the fix works
  on the actual endpoint

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-09-maxretries-override-sweep.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
