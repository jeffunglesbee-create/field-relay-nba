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
        ("ambiguous_key_count == 0",
         totals.get("ambiguous_key_count") == 0,
         totals.get("ambiguous_key_count")),
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
              f"ambiguous keys: {t.get('ambiguous_key_count')} · "
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
