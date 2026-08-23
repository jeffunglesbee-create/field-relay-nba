# EPL briefs grounded in events and the table — 2026-08-23

**Asks closed:** `CC-CMD-2026-08-21-fpl-event-grounding-epl`, and defect 2 of
`CC-CMD-2026-08-22-brief-sport-contamination`
**Status:** SHIPPED, verification STAGED — see Done condition below.

## Why one commit for two asks

They are one prompt block. An EPL brief needs the events when there are events,
and the TABLE when it falls back to season context. Building them separately
would have meant two passes over the same prompt site, and the season-stat half
is only correct in the presence of the event half — "Everton kept a clean sheet"
and "Everton sit 4th on 7 points" belong in the same paragraph.

## What the probe found, including one thing that contradicts the ask

Three CI probe runs (`outbox/fpl-event-shape-2026-08-23T03-2*.json`):

1. **`/fpl/event/{gw}/live/` returns every player** — 604 elements, 186 with
   minutes, 418 with none. Naming scorers is a filter, not a lookup.
2. **Per-fixture stats live in `explain[]`, not the top-level `stats`.** `stats`
   is the gameweek total, so in a double gameweek it over-attributes to whichever
   match is being written about. Everything reads `explain`.
3. **There is no minute-of-goal anywhere in this feed.** Not in `stats`, not in
   `explain`, not in `fixtures[].stats`.

Point 3 contradicts the ask's own example sentence, *"Saka scored in the 34th"*.
That sentence is not obtainable from this endpoint and nothing here will produce
it. Goalscorers, assists, cards, saves and clean sheets are obtainable; the
minute is not. The block states this to the model in its own text, because the
alternative is a model supplying one — and an assertion checks the block never
contains a minute marker itself.

## The join, derived rather than guessed

FPL and ESPN share no numeric id, so the bridge is name-to-name. The first probe
established that; the second asked for today's EPL rows and got **zero** —
GW1 was played 08-21/22, and a competition playing twice a week is absent from
most single days. An empty result is indistinguishable from a broken join, so
the third probe walks back until it finds a day with EPL rows.

From 2026-08-22, ten club names. Five matched FPL verbatim — Everton,
Sunderland, Leeds, Brentford, Spurs. Five did not, and those five are the map:

| ESPN | FPL |
|---|---|
| `Hull` | `Hull City` |
| `Man United` | `Man Utd` |
| `C Palace` | `Crystal Palace` |
| `Ipswich` | `Ipswich Town` |
| `Nottm Forest` | `Nott'm Forest` |

**Ten of twenty clubs have been observed.** The other ten resolve to null, get
no block, and are logged by name at the end of the cycle. There is deliberately
no fuzzy matcher: Rule 76 caps fallback chains, a normaliser is where two clubs
quietly become one, and guessing names is the golf incident's failure mode with
no compiler to catch it. The map is extended on observation, the same way the
laboratory models a sport when the drift sentinel reports it.

## Defect 2, and the stat that must not come back

A won-drawn-lost record is not used as season context. On an opening weekend
every side is 0-0-0, which is how a live 3-0 came to be called a "0-0-0
stalemate" — the stat was wrong for the competition *and* vacuous for the date.
`tableLine()` leads with position and points, says "no matches played yet"
rather than "0-0-0" for a side yet to play, and an assertion checks no
`\d+-\d+-\d+` can appear in its output.

bootstrap-static's `teams[]` already carries `position`, `points`, `played` and
`form`, so this needed no second source.

## Cost, and what it cannot break

`handleJournalismCycle` fires every 15 minutes (Rule 24). The fetch is memoised
per cycle and gated on the slate carrying an EPL game, so a slate without one
costs nothing and a slate with one costs three upstream requests per quarter
hour, at the same TTLs the `/fpl` proxy already uses — 3600s bootstrap, 30s
live. Plain `fetch` with `cf:{cacheEverything}` rather than `relayFetch`:
`cache-helpers.js` keys on the URL specifically because Cloudflare will not
cache a request carrying an `Authorization` header, citing the Kali audit. FPL
is unauthenticated, so that caveat does not apply.

Both the fetch and the per-game context call are wrapped. Any failure leaves the
block null and the prompt byte-identical to what it was before this change.

## Verification

`scripts/fpl-events-check.mjs`, 29 assertions. The two that matter most are
negative: a gameweek total of two goals across two fixtures must report **one**
in the fixture being written about, and an unobserved club must resolve to
`null` rather than to a near-miss. `prose-style-scope` 23, `voice-register-scope`
33, `cross-window` 24 all unchanged.

**Done condition — STAGED, and automated rather than remembered.** The wiring
landed between gameweeks, so there was no live EPL fixture to observe it on.
`verify-epl-grounding.yml` runs Mondays and Tuesdays 09:00 UTC and asserts,
across the EPL `game_recap` archive: no W-D-L record cited, no minute claimed
that the feed cannot supply, no "stalemate". It reports PENDING while the
archive holds no EPL recap, so an empty run cannot read as a pass.

Unblocked by: the next EPL matchday. Verify by hand with
`gh workflow run verify-epl-grounding.yml` or by reading
`outbox/epl-grounding-verify-*.json`.
