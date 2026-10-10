# CC session — BSD coordinate frames (CC-CMD-2026-10-10-bsd-coordinate-frames)

**Date:** 2026-10-10
**Repo:** field-relay-nba, branch `main` (no feature branch, no PR)
**Spec:** `docs/CC-CMD-2026-10-10-bsd-coordinate-frames.md` — 7 tasks, 3 stop conditions
**Outcome:** all 7 executed, all 4 done conditions verified against the DEPLOYED
route and a committed fixture. No stop condition hit.

## HEAD progression

| commit | what |
|---|---|
| `5b6a88d` | Task 6 — the frame verifier and its capture workflow |
| *(runner)* | `scripts/fixtures/bsd-223324-coordinates.json`, captured by run 38079042975 |
| `d2c32be` | Tasks 1-5, 7 — the contract object and the availability route |
| `22f8e68` | the deployed-contract verifier; the two conflicting CC-CMDs resolved |
| *(this)*  | done condition 3 asserted in the response; this doc |

Deploy run **38079475335**, success, at `22f8e68`.
Verification runs **38079766003** and **38079830092**, both success.

## What the spec said, and what was found

The spec's central claim is unusual and it held: **the declared axis is false
and the transform printed four lines below it is correct.** Both halves were
re-measured here rather than taken on trust.

- The six-keeper table reproduces exactly from a fresh capture: home Cleiton
  `x 10.6`, away Everson `x 10.4` in 223324. Under the old declaration the away
  keeper belongs near 90.
- The `gml` agreement reproduces on a wider sample than the spec quoted: **21 of
  32 shots discriminate left/right, 13 home and 8 away, and all 21 agree.** The
  spec said 24; the capture carries 32 shots, 11 of which are centre or
  unlabelled and constrain no sign. Rotation, not reflection, confirmed.
- The T. Cuello goal incident is field-for-field as quoted: `gk {5.4, 48.4}`
  beside `pos {7.3, 48}`.

**The mirror formula was not touched.** `x = 100 - x; y = 100 - y`, byte
identical, asserted as such by the live verifier. The old key name is kept
beside `mirrorAway` so existing readers do not break.

## Verified E2E (not STAGED)

1. `/bsd/contract` **served** at revision `2026-10-10-1`, no `provisional`,
   per-team axes, four distinct frames across five payload paths, verbatim
   record shapes — **18/18 assertions against the deployed response**, source
   not consulted.
2. The frame verifier **3/3** over the committed fixture.
3. Both mutations **applied and caught** (see below).
4. The three availability states, read from the live route's headers:

```
588245 (finished, websocket_plus false): HTTP 200 empty=true X-AvgPos-State=finished-no-data
588255 (in the live feed)              : HTTP 200 empty=true X-AvgPos-State=in-play
state coverage: 2 of 2 states exercised
```

Same empty body, different state. That is done condition 3, measured rather
than reasoned.

## Rule 90 — the mutation that was dead, and how

The keeper assertion's first mutation **changed no output**. Swapping the check
to its one-sided variant does nothing on a fixture whose data is correct,
because the one-sided check only misleads on BROKEN data. It reported "caught"
on the strength of the other assertion failing.

Rewritten to mutate the **data**, not the check:

```
mutation 1: assert gml on home shots only (the check is broken)
    applied: true   (away bucket emptied: 0 shots)
    caught : true
mutation 2: flip the away keeper onto a SHARED axis (the data is broken)
    applied: true   (away keeper x 10.4 -> 89.6)
    caught by the spread check  : true   (spread 79)
    MISSED by the one-sided check: true   <- why the one-sided form is banned
```

The harness now refuses to report a verdict unless every mutation is confirmed
applied — a NOT CAUGHT with no mutation applied is worse than no test.

Eight further mutations guard the contract verifier, each asserted applied then
caught: stale revision, `provisional` left in, the old shared-axis wording
restored, the old wording deleted instead of recorded, the formula edited, the
two pitch frames given the same origin, the invented `88.3` shot example put
back, and `n` renamed `touches`.

## Two CC-CMDs, filed 5.5 minutes apart, neither referencing the other

`2737d59 13:52:56` filed `-bsd-coordinate-contract.md`.
`b1fad7c 13:58:25` filed `-bsd-coordinate-frames.md`.

They conflict on one point. The earlier doc's done condition 2 requires
`coordinateSystem.unresolved.y` naming the shotmap as the resolver. The later
doc **resolves y, from the shotmap**, on exactly the evidence the earlier one
asked for. So `unresolved.y` was deliberately not added: publishing an open
question that has already been answered is worse than leaving the field out.

The earlier doc is marked SUPERSEDED in place with that reasoning, rather than
deleted or left live for someone to execute later and reintroduce the field.
Everything in it that does not conflict was carried — per-team axes, the real
`avgPosition` example, the required-on-away transform with the `scaleX(-1)`
warning, the keeper-spread check, the `websocket_plus` finding in the `avgPosM`
comment.

## Where the spec was not met literally, and why

Task 5 says "add the tier to the response so a caller can tell 'never for this
competition' from 'not yet'."

**The tier is not available to this route.** A full capture of 223324's
`/stats/` payload carries no `websocket_plus` and no other tier field —
confirmed by scanning the captured object, not inferred. Naming the cause would
cost a second upstream call on every empty response, which the spec's own second
stop condition ("if any task would add computation to the relay, STOP") and
Rule 78 both argue against.

So the relay reports the **state**, not the **cause**: `in-play`,
`finished-no-data`, `unknown`. The three states the spec enumerates are
distinguishable at the boundary, which is what done condition 3 asks for; the
tier itself is recorded as the measured cause in the route comment and named in
the contract's `status` as what remains open.

`unknown` exists because `_bsdEventLiveState` can fail, and "the check failed"
must not be served as "in play" (Rule 99). `_bsdEventIsLive` keeps its name and
its exact fail-safe (`unknown` -> treat as live, do not cache) for both existing
callers, audited before the split: `src/index.js` shotmap and momentum, both of
which use it only to decide whether caching is safe.

## Rule 47

Untouched. No value is computed. A declaration was corrected and a factual
availability state reported — the kind of classification the rule permits, and
served on pull only.

## Carry-forwards

**None from this CC-CMD.** Every task is closed inside this session.

Two observations for whoever picks up the area next, neither a deferral of this
spec's work:

1. **Frame coverage is one event.** The verifier says so in its own output
   (`COVERAGE: 1 event (223324), 21 of 32 shots discriminating`). Widening it
   means capturing another event — `.github/workflows/bsd-coordinate-capture.yml`
   takes an event id as an input and needs no code change to do it.
2. **`n` remains a count of unconfirmed definition.** It cannot be a shirt
   number (one team carries two players at `n: 32`), and it behaves like a touch
   count, but nothing in the feed says so. It is documented as unconfirmed
   rather than renamed on the strength of the old example.
