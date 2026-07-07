# CC-CMD: Correct two small findings in the drama-score-synthetic-benchmark outbox

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** documentation-only, outbox text edit, no code change.

**Source:** two real findings from independent verification of
`outbox/cc-drama-score-synthetic-benchmark-2026-07-07.md`, this session.

## TASK 1 — Fix the mislabeled comparison figure

Current text: "Prior estimate (**0.001ms/call**) gave 432ms/month at 10×
headroom." This is wrong — `0.001 × 15 × 96 × 30 = 43.2ms/month`, not
432. The figure that actually produces 432ms/month is **0.01ms/call**
(the upper end of the original 0.001–0.01ms range), not the lower end
as currently labeled. The "17× cheaper" conclusion itself is correct
(`432/25.1 ≈ 17.2`) — only the label on which estimate produces 432 is
wrong. Fix the label to "0.01ms/call."

## TASK 2 — Disclose the JIT warm-up caveat

The outbox justifies substituting Node.js timing for Workers timing
with "same V8 engine" — true but incomplete. Add a short, honest
caveat: the Node.js benchmark's 100k-iteration warm-up lets V8 fully
JIT-optimize the hot path in a long-running process; a real Workers
isolate serving a single request doesn't get the same warm-up
guarantee, so a cold or lightly-used isolate could run measurably
slower than this benchmark's steady-state number. State plainly that
this doesn't change the conclusion (25.1ms/month has enormous headroom
even at several multiples of 582ns) but should have been named rather
than left implicit.

## VERIFICATION
- Confirm the corrected label produces the right arithmetic when
  re-read (0.01 × 15 × 96 × 30 = 432).
- Confirm the new caveat doesn't change the final 97/100 score or the
  "negligible at any reasonable estimate" conclusion — it's a
  disclosure addition, not a new finding that reopens the measurement.

## DONE CONDITIONS
- [ ] "0.001ms/call" corrected to "0.01ms/call" in the comparison line
- [ ] JIT warm-up caveat added, honestly scoped, doesn't overstate the risk
- [ ] Nothing else in the outbox touched
- [ ] Outbox itself notes this was a same-day correction, not a new benchmark run

## CONFIDENCE SCORING TABLE
+50  Label corrected accurately
+40  Caveat added, correctly scoped, doesn't overstate or understate the risk
+10  Nothing else touched

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-synthetic-benchmark-outbox-corrections.md.
Fix the "0.001ms/call" label to "0.01ms/call" in the 432ms/month
comparison line, and add a short, honest caveat about Node.js JIT
warm-up vs. a real Workers isolate's lack of the same guarantee.
Documentation-only, no code change, no re-run of the benchmark. Do not
commit unless confidence >= 95. If score < 95, report verbatim and stop.
