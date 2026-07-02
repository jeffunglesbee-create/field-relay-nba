# Outbox — Soccer Player Cross-Check (BSD ↔ ESPN)

**Date:** 2026-07-02 (fourth update — supersedes all prior versions)
**CC-CMD:** docs/CC-CMD-2026-07-02-soccer-player-crosscheck.md
**Status:** SHIPPED, real CI-verified (run 28617870727, success)

---

## History, briefly (full detail in prior commits' manifest versions)

v1 (129f848): wrongly reported 9/10 competitions untestable — two real
param/shape bugs. v2 (e10e86e): corrected — 6/10 testable, but 3 had
severe ESPN roster gaps. v3 (6ed6b9b): built a continental-competition
fallback (UCL/Europa/Conference), closed most of laliga/bundesliga's
gaps, eflchamp only partially (4/24 rescued — no European competition
covers lower-league English clubs). **v4 (this version, commit
b36b41d):** Jeff pointed out lower-league English clubs are in FA Cup
and League Cup instead. Verified real (`eng.fa` 124 teams, `eng.league_cup`
70 teams; tested on 2 independent eflchamp teams, both went from 0
athletes to 30+ via the new fallback), added both. **eflchamp's gap is
now fully closed — 24/24 teams rescued.**

## Real testability + data quality, final state, verified via CI run 28617870727

| Competition | Real finished BSD event? | ESPN gap after all fallbacks |
|---|---|---|
| wc26 | Yes | 0/48 |
| ucl | Yes | 0/36 |
| europa | Yes | 0/36 |
| conference | Yes | 0/36 |
| eflchamp | Yes | **0/24** (was 24/24 before any fallback, 20/24 after continental-only) |
| laliga | Yes | 3/20 (Real Madrid/Atlético rescued via continental; 3 remaining have no fallback coverage found) |
| bundesliga | Yes | 2/18 (Bayern/Dortmund/Leverkusen rescued via continental; 2 remaining have no fallback coverage found) |
| epl, mls, seriea, ligue1 | No finished BSD event | N/A — **independently reconfirmed 2026-07-02** via `/bsd/events/by-date` across 4 real recent dates each (not just the `events/season` page-1 check that was wrong for the other 6). MLS: 0 events found on any checked date. EPL/Serie A/Ligue 1: all real fixtures on those dates show `notstarted`. Genuinely untestable right now, not a hidden bug. |

`espn_data_gaps` in the output JSON now flags **0** competitions (down
from 3 in v2, 1 in v3).

## Real results, run 28617870727

- **9 candidates** (7 WC26, 2 La Liga) — unchanged from v3; the eflchamp
  fix surfaced real roster data but no new mismatches within it (all
  24 eflchamp teams' rosters matched their BSD names exactly once real
  data was available — a good sign, not a bug).
- **82 unmatched** (down from 98 in v3, 125 in v2) — the eflchamp-gap
  noise is now gone; remaining unmatched entries are more likely to be
  genuine no-ESPN-match players, though the 5 teams still gapped
  (3 laliga + 2 bundesliga) still contribute some noise.
- **4 untestable**, all independently reconfirmed this round.

## Not yet done

- None of the 9 candidates reviewed or added to any `CANONICAL_PLAYER`-
  equivalent structure — soccer still has none in `identity-resolver.js`.
- 5 teams (3 laliga, 2 bundesliga) remain gapped with no fallback found
  yet — not checked whether they're in some other competition context
  (e.g. domestic cups for Spain/Germany) the way English lower-league
  clubs were. Worth checking if this matters, following the same pattern
  Jeff identified for England.
- No team-scoping fix for BSD↔ESPN matching itself (mitigated via
  exact-match preference + ambiguity flagging, not root-fixed).
