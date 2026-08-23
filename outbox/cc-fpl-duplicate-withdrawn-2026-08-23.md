# I rebuilt something that already existed — 2026-08-23

**Withdrawn:** `src/fpl-events.js` and its wiring, shipped earlier this session
in `576997b`.
**Already shipped, 2026-08-22:** `buildFPLMatchEventsContext` in
`src/context-assembler.js`, commits `5c3f4d5` and `eb02ac7`.
**Kept:** the league-table line, re-homed into the existing builder.

## What happened

`CC-CMD-2026-08-21-fpl-event-grounding-epl` reads **Status: open** in
field-laboratory. It was closed in the relay the next day. I probed the FPL
payload, probed the ESPN names, derived an alias map, wrote a module, wired it
into the journalism cycle, and shipped it — without checking whether the relay
had already done the work.

The relay's own HANDOFF names this exact failure from the same week: *"three of
five relay asks described work already done."* The Drive summary for this very
ask says the same thing about itself — *"That makes four relay-directed CC-CMDs
this week describing work already partly done."* I made it five, and I made it
after being told twice.

The laboratory's CC-CMD status is not the relay's state. Only the relay's HEAD
is.

## What the duplicate got wrong that the original had already fixed

Not just redundant — **wrong in the specific way the original had been corrected
for**, one day earlier.

| | mine | the shipped builder |
|---|---|---|
| event source | `element.explain[]` | `fixtures[].stats` |
| saves | filtered `>= 4` from `explain` | every keeper, from `fixtures[].stats` |
| team join | my own 5-entry name map | `_FPL_SHORT_TO_ESPN_ABBR`, in CONTRACTS.md |
| gate | `fixture.finished` | `fixture.started` |
| HTTP calls | 3 + a 604-element scan | 2 |

`eb02ac7` is literally titled *"read FPL events from fixtures[].stats, not
explain[]"*. Its reason: **`explain[]` carries only identifiers that SCORED
POINTS.** Saves pay 1pt per 3, so a keeper with 1–2 saves has no entry at all —
the original's `Saves:` line was dead code as first shipped, and mine
reintroduced the same dead line with a `>= 4` filter on top of a source that
cannot report low counts anyway.

The `finished` gate is the second one. FPL flips `finished` only once bonus
settles, hours after full time — Arsenal v Coventry read `finished: false` while
carrying a 3-0. Mine would have labelled every completed match "the state so
far, not a final account", permanently.

Two independent defects, both already found and fixed by someone who read the
payload more carefully than I did, both reintroduced by not looking.

## What survives, and why

**The league table.** The shipped builder emits goals, assists, own goals,
cards, penalties, saves, bonus and BPS — and no table. Defect 2 of
`CC-CMD-2026-08-22-brief-sport-contamination` is about the season stat being a
won-drawn-lost record, and that was genuinely unaddressed.

It now lives inside `buildFPLMatchEventsContext` as a `League table:` line built
from `bootstrap-static`'s `teams[]`, which that builder already fetches — no
extra request, no second module, no second team-identity map. That is where it
belonged from the start.

## What the withdrawal surfaced

Comparing `_FPL_SHORT_TO_ESPN_ABBR` against this season's club list is not
something either implementation did. The dictionary carries `BUR`, `WHU`, `WOL`;
this season's twenty include **Hull City, Ipswich Town and Coventry City**. An
unmapped club makes `teamIdFor` return null, and the builder returns `''` for
*both* sides of that fixture — no events, no table, silently.

`verify-epl-grounding.mjs` now compares the dictionary against the live team
list rather than against a copy of itself, so the gap is measured rather than
assumed. If it reports missing clubs, that is a real defect in the shipped
builder and the next commit's work.

## The rule that would have prevented this

Rule 72 already says it: an inherited claim must be verified before it is acted
on. I applied that to the ask's technical premises — I probed the payload, I
probed the names, I found the ask's "Saka scored in the 34th" example
unobtainable. I did not apply it to the ask's **status**, which is the one
premise that decides whether to write any code at all.

`git log --oneline --all | grep -i fpl` would have taken two seconds.
