# field-laboratory summary — the staged items are now one dispatch away

**Date:** 2026-08-22 · **Repo touched:** field-relay-nba
**Commits:** `49d1cb0` (probe + workflow), `af91e04` (corrected its own two errors)
**Covers the staged tails of:** `CC-CMD-2026-08-21-closing-odds-capture`,
`CC-CMD-2026-08-21-fpl-event-grounding-epl`

Three fixes shipped yesterday, each with its own "verify on the next fixture"
note. Three separate notes is how staged items become orphans (Rule 74), so
they are now one workflow that answers all three and states which are still
unproven.

---

## What it verifies

| # | claim | fix under test |
|---|-------|----------------|
| 1 | `closing_odds.captured_at > opening_odds.captured_at` | `887c843` backfill date gate |
| 2 | EPL / La Liga opening coverage above the 23.1% / 11.8% baseline | `e4ad440` → `bb04fc8` aliases |
| 3 | an EPL brief is no longer a season-stat template | `eb02ac7` `fpl_match_events` |

**Run it:** dispatch `staged-verification.yml`, or touch
`outbox/.trigger-staged-verification`. It writes a manifest to `outbox/` and
exits non-zero **only on a genuine regression**.

**No `schedule:`** — the unblocking event is a fixture being played, which no
cron can predict, and a daily run would mostly report PENDING. Same reasoning as
the workflow audit of 2026-08-16.

---

## The design rule: PENDING is never PASS

Every check reports its **qualifying row count** and returns **PENDING at zero**.
A check with no data has proved nothing, and must not read as green.

This is not theoretical caution. Earlier in this same session the `gNN` guard
looked green purely because no client writes had happened since its fix — a
vacuous test that only became meaningful once a positive control was added. The
same trap applies to all three checks here, so the row count is reported
alongside every status.

PENDING deliberately does **not** fail the run. Failing on "not yet proved"
would train everyone to ignore this workflow's exit code, which is exactly how a
verification job stops being read.

---

## First run failed two checks — and both were the probe's fault

Reported here rather than quietly fixed, because the failure mode is instructive.

**Check 1** filtered on `date >= date(fix)` — the **game's** date, not when its
odds were written. Games dated 2026-08-21 were priced at 10:00 that morning,
**twelve hours before the 22:40 deploy**. Eighteen pre-fix rows qualified, and
the check failed a fix for rows it never touched.

**Check 2** counted **future fixtures** in the denominator. MLS is pre-seeded
months ahead, so 326 unplayed rows with legitimately no opening line reported as
0% coverage — and flagged a regression that had not happened.

**That second one is the same mistake made twice in one day.** The first was the
"MLS is the volume case" claim, corrected from 20% to 48.6% on exactly this
basis a few hours earlier. Worth naming as a recurring failure mode: *a
denominator that includes rows the thing being measured could not possibly have
affected.* Future fixtures, pre-fix rows, unplayed games — same shape each time.

Corrected: check 1 now gates on the **opening capture timestamp** being after the
deploy; check 2 restricts to games **actually played**; both moved `>=` → `>` on
the deploy date.

---

## Current state, corrected run

```
closing_after_opening      (0 rows)  PENDING — no game priced since the fix
soccer_opening_coverage    (0 rows)  PENDING — no soccer fixture since the aliases landed
epl_brief_event_grounded   (0 rows)  PENDING — no EPL brief since the deploy
```

Which is the honest state at 00:40 UTC: the fixes landed hours ago and nothing
has played since. **All three remain unproven** — the code is deployed and CI is
green, but no fixture has yet exercised any of it.

Usefully, the probe is now demonstrated in both directions: it produced FAIL when
it had real (if wrongly scoped) rows, and PENDING when correctly scoped with
none. It is not a check that can only say yes.

---

## One check is deliberately weaker than the ask, and says so

Check 3 asserts *"this EPL brief is not the season-stat template"*, not the ask's
artifact of *"names a player who appears in that fixture's FPL stats."* Proving
the stronger claim needs the FPL payload joined against brief text, which a
D1-only probe cannot reach.

Rather than quietly assert the weaker thing under the stronger name, the manifest
carries the stronger claim as **UNPROVEN** and prints brief excerpts to read. A
verification that overstates its own reach is worse than one that admits its
limit (Rule 89/90).

---

## What this does not cover

- **The exposed Odds API key.** Rotation is still outstanding and is not
  something a probe can settle.
- **Residual D1 mutations** — 601 sport values, 539 ordinal ids, 41 mislabelled
  recaps — all awaiting authorization.
- **The two CC-CMDs' own text.** Both need laboratory edits this session cannot
  push: closing-odds should be withdrawn and re-filed as an *opening*-capture ask
  (its premise is stale — the hook was already landed and firing), and the FPL
  ask should drop "not wired yet" and its goal-minute example.
- **`La Real`** — the one alias decision left open deliberately.

---

## Next matchday

One dispatch turns all three PENDINGs into a real answer. If any flips to FAIL,
the manifest names the rows, so the diagnosis starts from evidence rather than
from re-deriving what was measured today.
