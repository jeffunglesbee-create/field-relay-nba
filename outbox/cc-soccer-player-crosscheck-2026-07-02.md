# Outbox — Soccer Player Cross-Check (BSD ↔ ESPN)

**Date:** 2026-07-02 (second update — supersedes both prior versions)
**CC-CMD:** docs/CC-CMD-2026-07-02-soccer-player-crosscheck.md
**Status:** SHIPPED, real CI-verified (run 28616453223, success)

---

## History of this manifest, so nothing here is taken on trust

1. **v1 (commit 129f848):** claimed 9/10 non-WC26 competitions untestable
   due to "season not started." Never actually verified — caused by two
   real bugs (wrong `league_id` param name, wrong response-array key)
   that silently made every league check return no results. **Wrong.**
2. **v2 (commit e10e86e):** corrected — 6/10 competitions genuinely have
   finished BSD events. But 3 of those 6 (eflchamp, laliga, bundesliga)
   showed severe ESPN roster gaps (up to 24/24 teams with <15 athletes),
   assumed to be an unfixable current-season data-sparsity problem.
3. **v3 (this version, commit 821593e):** Jeff asked directly whether the
   design assumes UCL/Europa/Conference and domestic-league player pools
   are disconnected. They aren't — verified live: BSD's `player_id` is
   globally stable across competitions for the same person, and ESPN's
   roster completeness is genuinely different by competition-context
   path even for an identical team ID (Atlético Madrid, id 1068: 1
   athlete via `esp.1`, 40 via `uefa.champions`, reproducible). Built a
   fallback that tries the same team ID under UCL/Europa/Conference
   before accepting a domestic gap. Materially reduced the "unfixable"
   gaps from v2.

## Real testability + data quality, verified via CI run 28616453223

| Competition | Real finished BSD event? | ESPN gap (teams below 15 athletes) | After fallback |
|---|---|---|---|
| wc26 | Yes (event 8346) | 0/48 | — no gap, unchanged |
| ucl | Yes (event 206718) | 0/36 | — no gap, unchanged |
| europa | Yes (event 206891) | 0/36 | — no gap, unchanged |
| conference | Yes (event 206891) | 0/36 | — no gap, unchanged |
| eflchamp | Yes (event 207505) | 24/24 before | **20/24 after** (4 rescued — correctly low; most Championship clubs aren't in these 3 European competitions) |
| laliga | Yes (event 1070) | 11/20 before | **3/20 after** (8 rescued, incl. Real Madrid, Atlético) |
| bundesliga | Yes (event 207461) | 18/18 before | **2/18 after** (16 rescued, incl. Bayern Munich, Dortmund, Leverkusen) |
| epl | No finished event found | N/A | N/A |
| mls | No finished event found | N/A | N/A |
| seriea | No finished event found | N/A | N/A |
| ligue1 | No finished event found | N/A | N/A |

`espn_data_gaps` in the actual output JSON now flags only **1** competition
(`eflchamp`) as still materially affected (≥25% of teams still gapped) —
down from 3 in v2.

## Real results, run 28616453223

- **9 candidates** (7 WC26: Turkish players + Christian Pulišić; 2 La
  Liga: Carlos Maciá, Aleksa Purić — the 2 new ones only findable because
  the fallback surfaced real roster data that was previously
  inaccessible). Full detail: `outbox/soccer-player-crosscheck.json`.
- **98 unmatched** — still includes real noise from `eflchamp`'s
  remaining 20/24 gap; not all 98 are genuine no-match players.
- **4 untestable** (epl, mls, seriea, ligue1 — genuinely no finished BSD
  event under the corrected `league_id` param).

## Not yet done

- None of the 9 candidates reviewed or added to any `CANONICAL_PLAYER`-
  equivalent structure — soccer still has no such structure in
  `identity-resolver.js`'s type registry (`_STRIP_BY_TYPE` only has
  `team` and `player` (MLB)).
- `eflchamp`'s remaining 20/24 gap has no further fallback available —
  most EFL Championship clubs genuinely don't play in UCL/Europa/
  Conference, so there's no same-team-ID alternate context to try. This
  is expected to stay a real, largely unfixable gap for this specific
  competition, not an open bug.
- No team-scoping fix for BSD↔ESPN matching itself (searches the whole
  competition's athlete pool, not just the two teams in a specific
  match) — mitigated via exact-match preference and ambiguity-flagging,
  not fixed at the root (no BSD route exists to scope by team for a
  given event).
