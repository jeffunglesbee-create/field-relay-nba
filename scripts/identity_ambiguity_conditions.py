#!/usr/bin/env python3
"""The done conditions of three open CC-CMDs, evaluated against a census response.

ONE definition. `.github/workflows/identity-ambiguity-watch.yml` runs it against
the live relay; `scripts/check-identity-ambiguity-conditions.py` runs it against
fixtures. A second copy in the test would be a copy of the source, which is the
substitution this repo's own rules prohibit — and the workflow is the harder of
the two to exercise, so the copy would be the one that drifted.

  CC-CMD-2026-09-13-team-key-sport-blind          Task 5
  CC-CMD-2026-09-13-alias-table-silent-overwrite  Task 5
  CC-CMD-2026-09-11-odds-identity-join-cfb        blocked until both close
"""

CC_CMDS = [
    "docs/CC-CMD-2026-09-13-team-key-sport-blind.md",
    "docs/CC-CMD-2026-09-13-alias-table-silent-overwrite.md",
    "docs/CC-CMD-2026-09-11-odds-identity-join-cfb.md",
]


def evaluate(d):
    """-> [(name, met, observed)]. Never raises on a missing field.

    A field the census did not send yields None, and None != 0, so the condition
    stays OPEN. Absence is not zero: a relay too old to carry
    `cross_sport_reach_failures` must not read as a relay with nothing left to
    fix (Rule 99). Same reason the by_sport lookups behaved that way.
    """
    amb = {a["key"]: a for a in (d.get("ambiguous_keys") or [])}
    totals = d.get("totals") or {}

    hull = amb.get("hullcity")
    return [
        ("hullcity claimed by one family",
         hull is None,
         "one family" if hull is None else " + ".join(
             f"{f}({v['rows']} rows, {'/'.join(v['names'])})"
             for f, v in hull["families"].items())),
        # RESTATED 2026-09-13, and the restatement is the point.
        #
        # These two conditions read `CFB substituted_rows == 0` and
        # `NFL substituted_rows == 0`. Under the fix that shipped (9366af9) they
        # can NEVER be met, and a condition that cannot be met is not a strict
        # watch — it is a watch that reports OPEN forever and gets muted.
        #
        # `substituted_rows` counts rows whose display name resolves, via
        # standalone `resolveTeamKey`, to a key not derived from that name.
        # `resolveTeamKey` was left unchanged ON PURPOSE: three callers
        # (ambient-do.js:822, wp-resolver.js:62, index.js:1219) bridge a vendor
        # name to a FIELD name with no payload in hand and depend on exactly
        # those short forms. So the count measures the ALIAS TABLE'S SHAPE — a
        # standing exposure — and never measured the defect.
        #
        # The defect was a cross-sport key ESCAPING into a join. That is what
        # the relay now probes per substituted (sport, name) pair, through the
        # deployed resolver and the real join module, and reports as
        # `cross_sport_reach_failures`. Zero is reachable and, unlike the old
        # wording, goes red if the fix is ever reverted.
        #
        # The exposure count is still printed by render() — as a readout, never
        # as a condition.
        ("no substituted name reaches another sport's club",
         d.get("cross_sport_reach_failures") == 0,
         "{} failing of {} probed".format(
             d.get("cross_sport_reach_failures"),
             d.get("cross_sport_reach_probed"))),
        # RESTATED 2026-09-13, hours after the one above, and for a different
        # reason — this one's blocker is the world, not a design choice.
        #
        # This condition read `ambiguous_key_count == 0`. All 11 keys it counts
        # were read from the live census rather than assumed, and every one is a
        # fact about how sport names teams: `richmond` is an AFL club and a CFB
        # programme; `sanfranciscogiants` is claimed by MLB's Giants and the
        # NFL's; `texasrangers` by MLB and a Scottish football side; seven MLS
        # and WNBA short forms are also CFB programme names. NO EDIT TO THIS
        # REPO MAKES THAT ZERO. Only sport-qualifying every join key would, and
        # that rewrites every join in the system.
        #
        # It is also inert, for a reason that has nothing to do with the alias
        # table: all three odds writers fetch the payload for the ROW'S OWN
        # sport, so a CFB row is never offered an MLS response. That is held by
        # scripts/check-odds-writers-sport-scoped.mjs in CI, where it belongs —
        # it is a property of the source, checkable without a live call, and a
        # six-hourly probe of production is the wrong instrument for it.
        #
        # WHAT A LIVE WATCH CAN SEE THAT CI CANNOT is the archive itself. Cross-
        # sport ambiguity cannot reach a join; WITHIN one slate there is no such
        # protection, and nothing had ever asked. Two rows in one (table, date,
        # sport) whose `${hk}|${ak}` join key is identical are indistinguishable
        # to byPair.get before any payload is consulted, and one vendor game
        # satisfies both — a false fact, not a missing one. Zero is reachable,
        # non-zero is a named bug report, and only the live archive can answer it.
        # NARROWED 2026-09-14, on a measurement rather than a preference.
        #
        # This condition read `same_slate_pair_collisions == 0` and sat at 115.
        # 82 of those are cup competitions filed under sport='MLS' — CONCACAF
        # Champions Cup, Leagues Cup, U.S. Open Cup, TELUS Canadian
        # Championship, Campeones Cup. Measured: 243 such rows, ZERO odds ever,
        # against 534 MLS-league rows carrying 172. The odds backfill buckets by
        # SPORT and matches them against a league payload that never contains
        # them, so a collision between two of them CANNOT produce the false odds
        # fact this check exists to stop. They were escalated by proxy.
        #
        # The raw count stays below as a readout — archive hygiene is worth
        # seeing. The CONDITION is the collisions a false fact can reach.
        ("no collision that can reach the odds join",
         d.get("same_slate_pair_collisions_with_odds") == 0,
         "{} reachable of {} total ({} inert)".format(
             d.get("same_slate_pair_collisions_with_odds"),
             d.get("same_slate_pair_collisions"),
             d.get("same_slate_pair_collisions_inert"))),
    ]


def render(d, conditions, when):
    lines = [f"### Identity ambiguity watch — {when}", "",
             f"`{d.get('coverage')}`", "",
             "| condition | state | observed |", "|---|---|---|"]
    for name, met, observed in conditions:
        lines.append(f"| {name} | {'**DONE**' if met else 'OPEN'} | `{observed}` |")
    t = d.get("totals") or {}
    # The raw substituted_rows count is deliberately NOT a headline. Most of it
    # is within-sport aliases working correctly; reporting it as a defect count
    # is the collapse b86b3e8 fixed.
    by = d.get("by_sport") or {}

    def sub(sport):
        return (by.get(sport) or {}).get("substituted_rows")

    lines += ["",
              # Readout, not a condition — see the restatement above. Kept
              # visible because a NEW ambiguous key is worth seeing even though
              # the existing 11 are inert and permanent.
              f"cross-sport ambiguity (not a condition): "
              f"{t.get('ambiguous_key_count')} keys claimed by two families · "
              f"rows touching one: {t.get('ambiguous_rows')} · "
              f"of those carrying odds: {t.get('ambiguous_rows_with_odds')}",
              "",
              # Readout, not a condition — see the restatement above. It is kept
              # visible because it is the denominator the reach probe ran over,
              # and because a rising exposure is worth seeing even though it is
              # not a defect.
              f"alias-table exposure (not a condition): {t.get('substituted_rows')} "
              f"substituted rows archive-wide · CFB {sub('CFB')} · NFL {sub('NFL')} · "
              f"reach probed over {d.get('cross_sport_reach_probed')} distinct "
              "(sport, name) pairs"]
    return "\n".join(lines)
