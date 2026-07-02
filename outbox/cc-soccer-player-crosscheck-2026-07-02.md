# Outbox — Soccer Player Cross-Check (BSD ↔ ESPN)

**Date:** 2026-07-02 (fifth update — supersedes all prior versions)
**CC-CMD:** docs/CC-CMD-2026-07-02-soccer-player-crosscheck.md
**Status:** SHIPPED, real CI-verified (run 28618776501, success)

---

## v5 change

Jeff asked whether the FA Cup/League Cup pattern (v4) would also apply
to non-English competitions. Checked precisely instead of assuming yes
— **mixed result, not a clean confirmation:**

- `esp.copa_del_rey` rescued **all 3** remaining La Liga gaps (Alavés,
  Elche, Osasuna).
- `ger.dfb_pokal` rescued **1 of 2** remaining Bundesliga gaps (SV
  Elversberg). **SC Paderborn 07 did not rescue** — confirmed a real
  DFB-Pokal participant (present in ESPN's team list for that
  competition), but consistently shows only 1 athlete there too
  (checked twice, not flaky). A genuine exception to the pattern, not
  a bug in the fallback logic.

## Final gap state, verified via CI run 28618776501

| Competition | Teams still gapped | Note |
|---|---|---|
| wc26, ucl, europa, conference | 0 | Never had a gap |
| eflchamp | 0 | Fully closed in v4 (FA Cup/League Cup) |
| laliga | **0** | Fully closed in v5 (Copa del Rey) |
| bundesliga | **1** (SC Paderborn 07) | No known fallback — genuine exception |

**Across all of soccer, exactly one team (Paderborn) remains gapped
with no currently-known recovery path.** `espn_data_gaps` in the output
JSON still reports 0 flagged competitions (1/18 is below the 25%
report threshold).

## Real results, run 28618776501

- 9 candidates (unchanged — the newly-rescued teams' rosters matched
  their BSD names exactly, no new mismatches surfaced)
- Unmatched count improved slightly further with laliga's full closure
- 4 untestable (epl, mls, seriea, ligue1 — independently reconfirmed
  in v4 via `/bsd/events/by-date`, unchanged)

## Not yet done

- 9 candidates still not reviewed or added to any `CANONICAL_PLAYER`-
  equivalent structure — soccer has none yet.
- SC Paderborn 07 remains genuinely unresolved — no further fallback
  context identified. Not investigated further; may just reflect
  ESPN's real current data state for this specific club with no
  workaround available via any competition context tried so far.
- No team-scoping fix for BSD↔ESPN matching itself (mitigated via
  exact-match preference + ambiguity flagging, not root-fixed).
