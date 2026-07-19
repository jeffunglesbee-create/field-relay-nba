# CC-CMD — MLS: Defensive Substitution Lead-Loss metric (relay + client)

**Date:** 2026-07-19 (updated same day — added Task 4, client-side wiring,
once a real client home for this metric was confirmed to exist: the Stats
tab, which had not yet been built when this CC-CMD was first written)
**Repo:** BOTH — relay task in field-relay-nba, new client task in jubilant-bassoon
**Branch:** main — commit directly on each repo. No PRs.

git remote get-url origin | grep -qE "field-relay-nba|jubilant-bassoon" || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — the real pattern, and why it matters

Real, recognizable pattern: a team leading a match makes defensive
substitutions to protect the lead, then loses control of the game and
concedes anyway (the real-world reference point: Tuchel's substitutions
for Germany against Argentina in the WC semifinal). This metric detects
that pattern directly from real match-event data — both directions: subs
that precede holding the lead, and subs that precede losing it.

**This is real, factual, event-derived computation (timeline + position
lookup + score-state tracking) — not a drama/interest/watch-worthiness
judgment. Consistent with Rule 47 (RELAY-CPU-A): this does not touch
drama scoring, watch verdict, or interest classification, all of which
stay client-only. This is closer to the existing xG computation pattern
(a real, objective stat derived from event data) than to anything
RELAY-CPU-A restricts.**

---

## REAL, DIRECTLY VERIFIED FINDINGS THIS SPEC IS BUILT ON — re-verify, don't trust blindly

All of the following was confirmed tonight via direct, live probes against
real ESPN endpoints for a real, completed MLS game (LAFC at LA Galaxy,
event 761664, final 3-0). Re-confirm the real, current shape before
building — payload shapes can drift.

1. `site.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary?event={id}`
   → `keyEvents[]`, each with real `type.text` (`"Goal"`, `"Penalty -
   Scored"`, `"Substitution"`, etc.), real `clock.displayValue` (e.g.
   `"65'"`), real `period.number`, real `team.displayName`, and for
   substitutions a real `participants[]` array with two `athlete.id`/
   `athlete.displayName` entries (index 0 = player coming ON, index 1 =
   player going OFF — re-verify this ordering directly, don't assume).
   Goal event `text` includes the real running score
   (e.g. `"Goal! LA Galaxy 0, Los Angeles Football Club 1"`).

2. Same summary payload's `rosters[]` → each team has a real `roster[]`
   array; each player entry has a real `position.abbreviation` (e.g.
   `"LF"`, `"CM"`, `"D"`) reliably correct for the player GOING OFF
   (a real starter), but genuinely, consistently shows `"SUB"` (not a
   real field position) for the player COMING ON — confirmed across all
   10 real substitutions in the test game, not a one-off.

3. `sports.core.api.espn.com/v2/sports/soccer/leagues/usa.1/athletes/{id}`
   → a separate, real per-athlete endpoint that DOES carry the real,
   true position (confirmed: athlete 366047, shown as "SUB" in the game
   roster, resolved to a real `position.name: "Defender"` here). This is
   the real, necessary extra call for each incoming substitute — no way
   found around it; don't assume it can be skipped.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "if (pathname === '/soccer/xg')" src/index.js
# Confirm real, current MLS_STATS_ALLOWED_PREFIXES / relevant ESPN passthrough patterns already in place
grep -n "site.api.espn.com/apis/site/v2/sports/soccer" src/index.js | head -10
# Re-verify the real participants[] ordering directly against a live probe
# before trusting this doc's note above.
```

---

## TASK 1 — New relay route: `/soccer/sub-impact`

`GET /soccer/sub-impact?league={league}&event={eventId}`

Real algorithm:
1. Fetch the real summary payload for `league`/`event`.
2. Build a real, chronological timeline from `keyEvents`, keeping only
   `Goal`, `Penalty - Scored`, and `Substitution` types.
3. For each `Goal`/`Penalty - Scored` event, parse the real running score
   from `text` (don't guess a parsing regex — inspect several real,
   actual examples directly first, scores can appear in different
   phrasings) to maintain a real, live score-differential-by-team state
   as the timeline progresses.
4. For each `Substitution` event:
   - Real position OFF: look up directly from this game's own `rosters[]`
     (already reliable).
   - Real position ON: call `sports.core.api.espn.com/v2/sports/soccer/leagues/{league}/athletes/{id}`
     for the incoming player's real `position.abbreviation`. Cache this
     per athlete ID within the request (a player can only appear once as
     an incoming sub per game, but avoid redundant calls if the code path
     could ever re-check).
   - Classify as **defensive** if the real position OFF is attacking
     (F, LF, RF, CM, RM, AM — confirm the real, full set of attacking
     abbreviations that actually appear in real MLS data, don't assume
     this list is exhaustive) and real position ON is defensive (D, LB,
     RB, CB, DM).
   - Record the real score state (which team led, by how much) at the
     exact moment of this substitution.
5. For each real, classified defensive substitution made while the
   subbing team held a real, positive lead: scan the real, subsequent
   timeline for any real goal by either team through the real end of the
   match. Explicitly record one of three real outcomes, not just the
   negative cases — the positive case (this is the point of "both
   directions") must be just as real and present in the output, never
   left as an implicit null:
   - **"held"**: no real goal by the opponent for the remainder of the
     match — the defensive sub genuinely worked, lead preserved.
   - **"challenged"**: the opponent scored, real score differential
     narrowed, but the subbing team still finished with the real lead.
   - **"lost"**: the opponent scored enough to tie or genuinely overtake
     — the lead did not survive.
   Record the real clock time of the sub, and of the deciding
   goal/full-time whistle for whichever outcome applies.

Real response shape:
```json
{
  "event": "761664",
  "defensiveSubs": [
    {
      "team": "LA Galaxy",
      "clock": "65'",
      "playerOff": "Miki Yamane",
      "positionOff": "RB",
      "playerOn": "Robert Taylor",
      "positionOn": "D",
      "scoreAtSub": {"leading": true, "differential": 1},
      "outcome": "held",
      "outcomeClock": "Full Time",
      "outcomeDetail": null
    }
  ],
  "hasDefensiveSubImpact": true
}
```
Adapt this shape as real testing reveals what's actually useful — this is
illustrative, not a rigid contract to force real data into. But the real,
explicit three-way outcome field ("held"/"challenged"/"lost") is not
optional — this is the actual mechanism that makes the metric answer
"both directions," not just the negative one.

## TASK 2 — Real, direct verification

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/soccer/sub-impact?league=usa.1&event=761664"
```
Real, honest check: this specific test game (LAFC 3, LA Galaxy 0) may not
have a real, clean "leading team makes defensive sub, then concedes"
example — confirm the route runs and produces structurally correct,
honest output either way. If no real qualifying case exists in this game,
find a different real, completed MLS game (or a real WC game, given the
same endpoints work there too) that does, and verify against that
directly — don't fabricate a synthetic pass.

## TASK 3 — Honest scope note on statistical meaning

Per-game output alone is anecdotal. Add this route as a real, single-game
primitive only — do NOT build any cross-game aggregation, "team X does
this Y% of the time" claim, or journalism-prompt integration in this
CC-CMD. That's real, separate follow-on work requiring a real sample size
across many games, out of scope here. State this limitation explicitly in
a code comment at the route itself, so a future session doesn't
accidentally treat single-game output as a trend.

---

## TASK 4 (client, jubilant-bassoon) — Wire into the Stats tab

Per a same-day reconciliation decision: the bottom sheet's per-game detail
panel is being split — raw stats/metrics content moves to the Stats tab
(`renderStatsSection`), narrative/journalism content stays in the bottom
sheet. This metric belongs in the Stats tab's MLS block, not the bottom
sheet — it is real, factual, event-derived computation (matching the same
Rule 47 reasoning already in this doc's own Context section above), not a
narrative element.

**⚠️ SEQUENCING NOTE — real, mechanical race with two sibling CC-CMDs,
read before starting this task:** `docs/CC-CMD-2026-07-19-mls-novel-metrics.md`
(its own Task 3) and `docs/CC-CMD-2026-07-19-bottom-sheet-stats-reconciliation.md`
(its own Task 1) both also add real, new content to this exact same
`renderStatsSection()` function. This is a mechanical overlap, not a
logical dependency — none of the three sub-sections depend on each
other's actual content — but all three editing the same function body in
parallel risks a real merge conflict or one session's changes silently
overwriting another's. **Execute these three sequentially, not in
parallel — re-pull and re-read the real, current state of
`renderStatsSection()` immediately before starting this task, even if
this doc's own probe block was run earlier the same session.** If either
sibling CC-CMD's commit has already landed, build on top of its real,
current diff rather than the version of the function this doc originally
investigated.

Add a real "Defensive Subs" sub-section to the MLS block in
`renderStatsSection()` (the same function the sibling
`CC-CMD-2026-07-19-mls-novel-metrics.md` also extends — confirm the real,
current state of that block first; this task may need to land after or
alongside that one, not assume it's first). Real content: for each recent,
completed MLS game with at least one classified defensive substitution,
show the real team, the real outcome (held/challenged/lost), and the real
clock times — following the same `row()` helper pattern already
established for other Stats tab blocks.

**Real, honest scope note:** this is still genuinely single-game data,
not a season aggregate (same limitation as Task 3 already states). Label
it as such in the UI — e.g., "recent defensive substitutions," not a
"team X does this Y% of the time" framing, which would require the
explicitly out-of-scope cross-game aggregation.

---

## DONE CONDITION

`/soccer/sub-impact` genuinely returns real, correctly classified defensive
substitutions with real score-state context, verified against at least one
real, completed MLS or WC game where the pattern is honestly checkable —
not fabricated. No cross-game aggregation or journalism wiring included.
The Stats tab genuinely renders this real data in a new Defensive Subs
sub-section, correctly labeled as single-game, not season-trend.

**Confidence scoring:**
- TASK 1 (45 pts): real, correct timeline/classification/position-lookup logic, verified against real payload shapes probed fresh from HEAD
- TASK 2 (25 pts): real, direct verification against real data, honest handling if the test game lacks a qualifying case
- TASK 3 (10 pts): explicit scope-limiting comment present, no premature aggregation built
- TASK 4 (20 pts): real Stats tab wiring, correct single-game labeling, follows the established `row()` pattern

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
