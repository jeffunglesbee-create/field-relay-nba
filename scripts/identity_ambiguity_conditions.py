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

    A sport absent from by_sport yields None, and None != 0, so the condition
    stays OPEN. Absence is not zero: a sport that stopped being archived must
    not read as a sport with nothing left to fix (Rule 99).
    """
    by_sport = d.get("by_sport") or {}
    amb = {a["key"]: a for a in (d.get("ambiguous_keys") or [])}
    totals = d.get("totals") or {}

    def substituted(sport):
        return (by_sport.get(sport) or {}).get("substituted_rows")

    hull = amb.get("hullcity")
    return [
        ("hullcity claimed by one family",
         hull is None,
         "one family" if hull is None else " + ".join(
             f"{f}({v['rows']} rows, {'/'.join(v['names'])})"
             for f, v in hull["families"].items())),
        ("CFB substituted_rows == 0", substituted("CFB") == 0, substituted("CFB")),
        ("NFL substituted_rows == 0", substituted("NFL") == 0, substituted("NFL")),
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
    lines += ["",
              f"ambiguous keys: {t.get('ambiguous_key_count')} · "
              f"rows touching one: {t.get('ambiguous_rows')} · "
              f"of those carrying odds: {t.get('ambiguous_rows_with_odds')}"]
    return "\n".join(lines)
