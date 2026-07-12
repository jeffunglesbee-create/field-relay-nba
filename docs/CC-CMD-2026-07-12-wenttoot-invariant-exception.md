# SUPERSEDED IN PART — READ THIS FIRST

Chat found, after dispatching this CC-CMD, that the "genuinely unresolvable"
premise from the historical-backfill CC-CMD's outbox does not hold for most
of these 36 rows. Do not build the acknowledged-exceptions list yet.

**Real finding, verified live, not theorized:** 20 of 22 MLB "unresolvable"
rows cluster on exactly two dates (2026-06-20, 2026-06-21). ESPN's data for
both dates is confirmed intact (14-15 real games each, fetched live).
Comparing a resolved row against an unresolved one:

- `2026-05-28-mlb-losan-colora` (resolved fine): `home: "Los Angeles
  Dodgers"`, `espn_event_id: "401815526"` — full name, real ID.
- `MLB_2026-06-20_tigers_whitesox` (marked unresolvable): `home: "Tigers"`,
  `espn_event_id: null` — short nickname only, no ID.

These rows came from a different ingestion path (different ID format too:
`SPORT_YYYY-MM-DD_shortname` vs the standard `yyyy-mm-dd-sport-...`) that
never populated `espn_event_id` and stored abbreviated names. The matcher's
ID-first-then-full-name-fallback strategy cannot work against this shape —
not because ESPN lacks the game, but because the row's own data doesn't
match what the matcher expects.

A second, smaller, different pattern also confirmed: `wnba_2026-06-07_
newyorklib_indianafev` has full names AND a real `espn_event_id`, and still
failed — likely a stale/mismatched `date` field causing a date-scoped ESPN
query to miss it even though the ID itself is valid. Different fix: look up
by ID directly, don't require date-match.

## REVISED SCOPE

**TASK 0 — Probe (do first, before anything else):** re-run the exact
violation query, then for each row check: does `espn_event_id` exist? Does
`home`/`away` look like a full name or a short nickname? Bucket every row
into (a) short-name/null-ID — likely fixable via TASK A, (b) full-name/
real-ID — likely fixable via TASK B, (c) neither pattern — genuinely unknown,
only these go in the acknowledged-exceptions file from the original TASK 1.

**TASK A (new) — For short-name/null-ID rows:** using the already-fetched
live `/v2/games` response for that row's date, match by team nickname
(e.g. "Tigers" is a substring/suffix of "Detroit Tigers") and backfill the
real `espn_event_id`, then run the existing went_to_ot computation against
it. Verify each resolved row against the real live game, not assumed.

**TASK B (new) — For full-name/real-ID rows that still failed:** look the
game up directly by `espn_event_id` (a per-ID ESPN endpoint, not the
date-scoped `/v2/games` listing) rather than by date. If the ID resolves to
a real game with a different date than what's stored, that confirms the
date-mismatch theory — backfill `went_to_ot` from that lookup and consider
(separately, don't fix unprompted per Rule 69) whether the stored `date`
itself should be corrected.

**TASK 1 (original, now narrowed) — Acknowledged-exceptions file:** only
for whatever remains after TASK A/B — rows where the live data genuinely
does not exist anywhere findable, not the default assumption.

**TASK 2/3 (original) — still apply**, but now to the genuinely-smaller
remaining exception list, if any exists after TASK A/B.

## DONE CONDITION (revised)

Report the real before/after split: how many of the 36 got resolved via
TASK A, how many via TASK B, how many remain genuinely unknown. Do not
report a number without having actually tried to resolve each bucket first
— "probably unresolvable" is not the same claim as "attempted and failed."

Confidence scoring unchanged in spirit — re-score against what actually
happened, weighted toward TASK A/B genuinely being attempted before any
row is written to the exceptions file.
