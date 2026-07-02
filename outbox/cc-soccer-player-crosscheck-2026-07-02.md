# Outbox — Soccer Player Cross-Check (BSD ↔ ESPN)

**Date:** 2026-07-02 (updated — supersedes the same-day earlier version)
**CC-CMD:** docs/CC-CMD-2026-07-02-soccer-player-crosscheck.md
**Status:** SHIPPED, real CI-verified (run 28615428531, success), correction applied

---

## Correction to the original manifest

The version of this manifest shipped with commit `129f848` stated 9 of 10
non-WC26 competitions were untestable because "2026-27 European domestic
season not yet started." That claim was **never actually verified** — the
script had two real bugs (wrong `league_id` query param name, wrong
response-array key) that silently made `findFinishedBsdEvent` return null
for every competition regardless of real data. Fixed same day (commits
`b520077`, `55db8ee`). The real picture is materially different.

## Real testability, verified via actual CI run 2026-07-02

| Competition | Real finished BSD event? | ESPN 2026-27 rosters populated? |
|---|---|---|
| wc26 | Yes (event 8346) | Yes — 1246 real athletes |
| ucl | Yes (event 206718) | Yes — 1268 real athletes, no data gap |
| europa | Yes (event 206891) | Yes — 1246 real athletes, no data gap |
| conference | Yes (event 206891) | Yes — 1174 real athletes, no data gap |
| eflchamp | Yes (event 207505) | **No — 24/24 teams below 15 athletes** |
| laliga | Yes (event 1070) | **Partial — 11/20 teams below 15 athletes** |
| bundesliga | Yes (event 207461) | **No — 18/18 teams below 15 athletes** |
| epl | No finished event found | N/A |
| mls | No finished event found | N/A |
| seriea | No finished event found | N/A |
| ligue1 | No finished event found | N/A |

The ESPN roster gaps are **real, confirmed live 2026-07-02, not a script
bug**: Real Madrid, Barcelona, Bayern Munich, Borussia Dortmund, and Bayer
Leverkusen all show 0 athletes on ESPN's roster endpoint right now. The
gap is inconsistent per-team even within one league (11 of 20 La Liga
teams, not all 20) — this is 2026-27 preseason data sparsity on ESPN's
side, not something this tool can fix.

## Real results, run 28615428531

- **7 candidates** (all diacritic-normalization cases, WC26: Turkish
  players + Christian Pulisic — see `outbox/soccer-player-crosscheck.json`
  for full detail)
- **125 unmatched** — the large majority of these are noise from the
  eflchamp/laliga/bundesliga ESPN data gaps, NOT genuine mismatches. Do
  not treat this count as 125 real findings.
- **4 untestable** (epl, mls, seriea, ligue1 — genuinely no finished BSD
  event, verified with the corrected `league_id` param)
- **3 competitions flagged in `espn_data_gaps`** (eflchamp, laliga,
  bundesliga) — the mechanism added to distinguish real data-gap noise
  from genuine candidates going forward

## Not yet done

- None of the 7 candidates reviewed or added to any `CANONICAL_PLAYER`-
  equivalent structure — soccer has no such structure yet (`identity-
  resolver.js`'s `_STRIP_BY_TYPE` only has `team` and `player` (MLB)).
- The 125 unmatched entries have not been individually reviewed to
  separate genuine no-match players from ESPN-data-gap noise beyond the
  aggregate `espn_data_gaps` flag.
- No team-scoping fix for the BSD↔ESPN matching (searches the whole
  tournament/league athlete pool, not just the two teams in a given
  match) — mitigated by preferring exact matches and flagging ambiguous
  cases, not fixed at the root, since no BSD route exists to scope by
  team for a specific event.
