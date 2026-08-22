# field-laboratory summary — FPL event grounding, BUILT

**Date:** 2026-08-22 · **Repo touched:** field-relay-nba
**Closes:** `CC-CMD-2026-08-21-fpl-event-grounding-epl`
**Commits:** `5c3f4d5` (build), `eb02ac7` (corrected event source)
**Prerequisite summary:** `outbox/lab-summary-2026-08-21-fpl-identity-contract.md`

EPL briefs no longer have to be season-stat templates. The relay now assembles a
`[FPL MATCH EVENTS]` block naming who scored, assisted, was carded, kept the ball
out and took the bonus — for the specific fixture.

---

## 1. The output, on the fixture the ask nominated

Rendered from the real payload for Arsenal 3-0 Coventry (GW1, fixture 1):

```
[FPL MATCH EVENTS]
Goals: Saka (ARS), Ødegaard (ARS), Havertz (ARS)
Assists: Calafiori (ARS), White (ARS), Tzolis (ARS)
Yellow cards: Gabriel (ARS), Yirenkyi (COV)
Saves: Rushworth (COV) 2, Raya (ARS) 1
FPL bonus: Ødegaard (ARS) +3, White (ARS) +2, Saka (ARS) +1
Top BPS: Ødegaard (ARS) 41, White (ARS) 37, Saka (ARS) 36
(FPL carries no goal timings — do not state minutes from this block.)
```

That is the ask's own test case, grounded. Compare what the brief said before:
*"Arsenal hosts Coventry at Emirates Stadium with both sides holding 0 points
through 0 matches this season."*

**Shipped as a new context source**, `fpl_match_events`, priority 5, budget 400,
`sports: ['epl']`. Separate from the existing `fpl_player_context` (Rule 69) —
that one is pre-game, who is dangerous by ICT/xG; this is what occurred. Priority
5 puts events above the pre-game analytics.

---

## 2. The ask's premises — one held, one was stale

**HELD:** the field list. `goals_scored, assists, yellow_cards, red_cards,
minutes, saves, bonus` are all present, `modified` too. That is the first
Drive-sourced claim this session that survived measurement intact — worth saying,
given how many did not.

**STALE:** *"Not wired yet."* `buildFPLPlayerContext` already exists and is a
registered live context builder (`priority: 8, budget: 150`,
`context-assembler.js`). FPL bootstrap data has been flowing into EPL briefs
since July 15. So this was a new data read into an existing slot, not a new
integration — the build was materially smaller than the ask implies. That makes
**four** relay-directed CC-CMDs this week describing work already partly done.

---

## 3. The probe caught a defect in the first version

The build initially read events from `element.explain[].fixture`, whose shape had
been probed. The fixtures payload also carries its own `stats` array, which was
noticed and deliberately left alone rather than used unread. Diffing both routes
on the same fixture:

| identifier | `fixtures[].stats` | `explain[]` |
|------------|-------------------|-------------|
| goals, assists, cards, bonus | ✓ | ✓ identical |
| **saves** | **2** | **0** |
| **bps** | ✓ | absent |
| minutes, clean_sheets, goals_conceded | absent | ✓ |

**`explain[]` carries only identifiers that SCORED POINTS.** Saves pay 1pt per 3,
so a keeper with 1–2 saves has no entry at all. Raya (1) and Rushworth (2) are
both real and both invisible to it — **the `Saves:` line was dead code as first
shipped.**

Rewritten onto `fixtures[].stats`, which carries every event identifier
unconditionally plus `bps`, in a response the builder already fetches. The
corrected route is also **one HTTP call cheaper** and drops a 600-element
gameweek scan. Its `h`/`a` split gives team attribution directly.

Neither route is a superset of the other — the same shape as `keyEvents` vs
`commentary` in the odds work. `fixtures[].stats` is authoritative for events;
`event/{gw}/live` retains minutes/clean_sheets if those are ever wanted.

---

## 4. Two other corrections from measuring rather than estimating

- **Budget was wrong.** Declared 200; the real block is **391 characters**. That
  would have under-reported this source's cost to the assembler's running total
  and silently crowded out later sources. Now 400.
- **Bonus hid third place.** The shared count helper suppresses a value of 1, so
  Saka's `+1` rendered bare. Bonus now always prints its value — 3/2/1 *is* the
  award.

---

## 5. What FPL cannot do, stated in the code

**There are no goal minutes anywhere in this payload.** `minutes` is minutes
played. The ask's example prose — *"Saka opened the scoring in the 34th,
Ødegaard assisting"* — is **not satisfiable from FPL**, and the builder does not
pretend otherwise: it emits who and how many, never a timestamp, and closes the
block with an explicit instruction telling the generator not to infer one.

Minutes remain ESPN `keyEvents`' job, which `CONTRACTS.md` already makes
authoritative for match narrative. The ask should drop that example or attribute
it to ESPN.

---

## 6. Safety properties

- Gates on `fixture.started`, **not** `finished`. Arsenal v Coventry read
  `finished: false` while carrying a 3-0 and 11 stat blocks, because FPL flips
  that only once bonus settles hours later. Gating on `finished` would mean
  recaps never fire. (`finished_provisional` was `true` — the usable flag.)
- Team join uses the scoped `_FPL_SHORT_TO_ESPN_ABBR` dictionary, never the
  cross-sport `resolveTeamKey`, where FPL's `"SUN"` resolves to the WNBA
  Connecticut Sun. Guarded, and recorded in `CONTRACTS.md`.
- Whole builder is try/catch-wrapped: a context-source failure must never break
  brief generation (Rule 5).
- Gameweek falls back `is_current → is_next`, so the window between gameweeks
  does not silently no-op.

---

## 7. Not verified, and what would verify it

**Staged (Rule 74):** a real EPL brief rendering this block end to end.
**Blocked by:** needs a journalism cycle on an EPL matchday after the `eb02ac7`
deploy. GW1 is complete; the next EPL fixtures are the unblock.
**Verify:** an `/archive/query?sport=EPL` brief whose `brief_text` names at least
one player who appears in that fixture's `stats` — an enumerated pass/fail per
row, which is the ask's own stated artifact.

Everything upstream of that is verified: payload shape, gameweek resolution, the
join, the event source diff, and the rendered block above.

---

## 8. Available and unbuilt, for whoever scopes the next one

Measured in the live payload, not currently read:

- **Expected goals family** — `expected_goals`, `expected_assists`,
  `expected_goal_involvements`, `expected_goals_conceded`. Per-match xG turns
  "Arsenal won 3-0" into "Arsenal won 3-0 from 1.9 xG". ADR-002-safe; Rule 1
  names xG explicitly as commodity.
- **Defensive contribution** — `tackles`, `recoveries`,
  `clearances_blocks_interceptions`, `defensive_contribution`. Nothing else in
  FIELD carries per-player defensive volume for EPL.
- **Fixture difficulty** — `team_h_difficulty` / `team_a_difficulty`, pre-game.
- **Phase 2, as the ask itself flags:** `now_cost`, `selected_by_percent`,
  `transfers_in_event` — a fantasy panel, not brief grounding.

If one is picked next, per-match xG/xA is the highest narrative value per line of
code and uses fields already fetched.
