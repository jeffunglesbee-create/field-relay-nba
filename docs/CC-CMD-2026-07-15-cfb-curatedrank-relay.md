# Claude Code Command — Forward ESPN's curatedRank on CFB/CBB competitor objects (relay repo)

**Date:** 2026-07-15
**Repo:** field-relay-nba (sole — this is a relay-adapter shape change; do not attempt this in jubilant-bassoon)
**Branch:** main — commit directly, do not create a feature branch or PR.

## CONTEXT — real gap found while executing CC-CMD-2026-07-15-featured-tier-overflow (jubilant-bassoon)

That CC-CMD built a generic client-side featured-tier promotion mechanism (`isFeaturedTierGame`, `index.html`) with three signals: rank ≤25, Scout's Pick, MY_TEAMS. The rank signal reads `g.homeCuratedRank`/`g.awayCuratedRank` — fields that do not exist in any real data reaching the client today, confirmed two ways:

1. Client-side: zero occurrences of `curatedRank` anywhere in `index.html` (confirmed via direct grep).
2. Relay-side: read `adaptESPNFootball(ev, sport)` directly from `field-relay-nba`'s real source (via `mcp__FIELD_Handoff__read_file`, not the `read_source` search tool, which unreliably returns zero hits for terms that do exist — confirmed this independently tonight for an unrelated term too). Its `home`/`away` objects are built as `{name, abbr, score}` only — no rank field is read from `comp.competitors[]` or forwarded at all.

ESPN's real, confirmed-live shape (checked directly against a real CFB scoreboard fetch) puts `curatedRank: {current: N}` directly on each competitor object (1-25 for ranked teams, 99 for unranked) — the same field, same shape, confirmed on a real historical college-basketball scoreboard query too (Michigan Wolverines `curatedRank: {current: 3}`), so this is a genuine ESPN-wide convention, not CFB-specific.

The jubilant-bassoon client already reads `g.homeCuratedRank`/`g.awayCuratedRank` defensively (`?? 99` — absent data is safely treated as unranked, no crash, no fallback data invented) — this relay-side change is the only remaining piece needed for the rank signal to ever fire on real data. Scout's Pick and MY_TEAMS already work today and are unaffected either way.

## TASK 0 — Probe

Read `adaptESPNFootball(ev, sport)`'s current real source in full (it will have drifted slightly from the citation above). Confirm the exact real field path for a competitor's rank in a live ESPN CFB scoreboard response — `curatedRank.current` per tonight's confirmation, but re-verify directly against a real, current fetch rather than trusting this doc's citation alone, per this repo's own CHALLENGE-A convention.

## TASK 1 — Fix

Add `curatedRank` to both `home` and `away` objects in `adaptESPNFootball`'s return value, flattened to a plain number (matching this function's existing convention of flattening `score`, not nesting): `curatedRank: home.curatedRank?.current ?? null` / `curatedRank: away.curatedRank?.current ?? null`. Do not add this to `adaptESPNMLB` or any other sport's adapter — this is specifically an American-football (NFL/CFB) + future CBB convention, confirmed only for those.

## TASK 2 — Verify

Real forced-condition test: a synthetic ESPN scoreboard event shaped exactly like the real confirmed payload (`competitors: [{homeAway:'home', curatedRank:{current:3}, ...}, {homeAway:'away', curatedRank:{current:99}, ...}]`) → `adaptESPNFootball` returns `home.curatedRank === 3`, `away.curatedRank === 99`. A competitor with no `curatedRank` field at all (defensive case) → `curatedRank: null`, not a crash. Confirm via a real, live CFB or CBB scoreboard fetch if one is reachable at execution time (CFB season doesn't start until August); if not reachable, state that plainly rather than asserting success from the synthetic test alone.

## DONE CONDITION

`adaptESPNFootball`'s `home`/`away` objects carry a real `curatedRank` number (or `null`) sourced from ESPN's actual `curatedRank.current` field. This alone does not yet make rank data reach jubilant-bassoon's card grid — that requires the separate CFB section-injection pipeline (see the companion CC-CMD in jubilant-bassoon, `CC-CMD-2026-07-15-cfb-section-injection.md`) to also thread `fg.home.curatedRank`/`fg.away.curatedRank` through to `g.homeCuratedRank`/`g.awayCuratedRank` on the schedule objects the client's `isFeaturedTierGame` reads.

**Confidence scoring:**
- TASK 0 (30 pts): re-verifies the real ESPN field path directly, doesn't trust this doc's citation alone
- TASK 1 (40 pts): correctly scoped to `adaptESPNFootball` only, matches the function's existing flattening convention
- TASK 2 (30 pts): real forced test for both the present and absent cases; live verification attempted and honestly reported if unreachable

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
