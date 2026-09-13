# CC session — a partial route parse now says so, and why the window is not the fix

**Date:** 2026-09-13 UTC · **Repo:** field-relay-nba · **Branch:** `main` (`5fa598d`)
**CC-CMD CLOSED:** `2026-09-12-route-provenance-truncation-invisible`
**Second CC-CMD filed:** `2026-09-13-route-scan-brace-balance-defeated`

---

## The defect: a flag that was set correctly and never read

`bodyOf` scans forward at most 1500 lines for brace balance and sets
`truncated: true` when it gives up. Its own comment says it: *"An unbalanced
block must say it did not parse, not hand back an empty answer that reads as
fact."*

**Nothing downstream read it.** A partial parse and a complete one landed in
`src/route-provenance.js` in the identical shape — Rule 99 inside the provenance
instrument itself.

## Task 0 — with the denominator

**2 of 225 routes truncate:** `/archive/` and `/mcp`. The CC-CMD said not to
assume `/archive/` was the only one, and it wasn't.

## Task 1 — carried and emitted

`t: 1`, sticky across the merge: if any sighting of a path was truncated, that
entry's sources are a partial read. The generated header explains why it is not
cosmetic, using the case that produced the CC-CMD: `/archive/`'s window ended
nine lines past the `/cfl/` routes, so it claimed `echo.pims.cfl.ca` and
`www.cfl.ca`; adding ~40 unrelated lines pushed those out and the hosts silently
vanished. Neither value was a fact about `/archive/`.

The builder prints the partial reads **by name**, not just a count — a count
with no names is a count nobody acts on.

## Task 4 — the gate re-derives rather than trusts

`check-route-provenance.mjs` recomputes truncation from the scanner and compares
against the committed manifest. If the builder ever stops carrying the flag, the
two disagree and the deploy fails:

```
ok   every partial read says so (scanner 2, manifest 2, of 189 entries)
```

## Task 3 — four mutations, because the defect was wiring

The flag was set right and dropped in transit, so the mutations break the wiring
at each point it could break again:

| mutation | what it simulates |
|---|---|
| `WINDOW` → 200 | a forced truncation, not a deleted flag |
| scanner stops setting `truncated` | the source of the signal |
| builder drops it in the merge | **the original defect exactly** |
| builder stops emitting `t: 1` | carried all the way, not written down |

All four caught on the partial-read assertion specifically. The harness asserts
all three touched files are byte-identical to HEAD afterwards, so a rebuild from
a mutated builder cannot leak into the tree.

## Task 2 — raising the window is strictly worse. Measured.

| `WINDOW` | truncated (of 225) |
|---|---|
| 1500 | 2 |
| 3000 | 1 |
| 6000 | 1 |
| 12000 | **0** |

Zero looks like the fix. It is not. At 12000 — more than half a 20,730-line
file — `/archive/` claims **50 hosts**: ATP, WHOOP, Dropbox, Wikimedia,
Bundesliga, fantasy.premierleague, essentially every upstream the worker
contacts. It fetches about five. And it loses `t: 1`, because the scan
"balanced".

So the manifest goes from **under-reporting and flagged** to **wildly
over-reporting and confident** — on a value stamped onto live responses.

The CC-CMD predicted the shape: *"it changes which routes are wrong without
making any of them say so."* The measurement is worse than the prediction, and
it is only a measurement because Task 1 landed first. That ordering was the
CC-CMD's instruction and it was right.

**WONTDO, on evidence.**

## What Task 2 actually uncovered

A block that needs 12,000 lines to balance is not a 12,000-line block. The brace
counter is being defeated inside `/archive/`'s dispatch and only works off the
imbalance by swallowing most of the file.

Filed as `CC-CMD-2026-09-13-route-scan-brace-balance-defeated` with a Task 0
that must **print the line numbers where depth crosses back above zero** before
anyone reaches for a fix. The leading hypothesis — braces inside string, regex
or template literals counted as structure — is explicitly **not claimed**: the
parent CC-CMD's whole lesson was that a boundary artifact reads exactly like a
fact, and "it must be the strings" is a boundary artifact of my own reading
until the depth trace prints.

## Carried forward

Nothing loose. Task 2 is answered rather than deferred; its root cause has its
own CC-CMD with a done condition that rejects the cheap win — *"the done
condition is not zero truncated"* — because a zero reached by swallowing the
file is the failure it exists to prevent.
