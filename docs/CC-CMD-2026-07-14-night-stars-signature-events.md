# Claude Code Command — HRD-native drama signal for Night Stars

**Date:** 2026-07-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole — `computeNightStars`/`recomputeNightStars` live in `src/analytics-engine.js` here; confirmed jubilant-bassoon has no equivalent server-side scoring code, only client display. If TASK 0 finds this doc wrong about that, stop and report rather than proceeding cross-repo.)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/night-stars-signature-events-2026-07-14.md. Commit the outbox manifest with `[skip ci]` in the message — it's a docs-only addition after the real fix commits are already in and deployed; do not let it re-trigger CI.

## CONTEXT

Night Stars rated the night of the 2026 Home Run Derby (July 13) at 2/5 stars. Confirmed root cause: HRD is not represented anywhere in `computeNightStars`'s input (`ctx.games?.regular`/`ctx.games?.postseason`) at all — the rating was computed from 3 unrelated slate games, not because HRD's drama was under-weighted. Real final: Jordan Walker down 8-11 with one swing left in the final round, hit 4 straight home runs to win 12-11 — a genuine, high-drama comeback that produces zero signal under the current win-probability-based formula (`drama_peak`, score-margin, OT-text-regex, walkoff-regex — all modeled on standard two-team competitive games, none of which map onto HRD's actual structure).

**Patent posture, resolved, do not re-litigate:** a July 7-8 2026 corrective pass established push vs. pull (not client/server location) as the real RUWT patent claim boundary — a relay computing and serving a rating on pull (exactly what `/analytics/night_stars/{date}` already does) supplies no more of the claimed invention than an ordinary scoreboard API. Server-side computation for this feature is fine. **Separately, and unaffected by that correction:** Rule D (raw-number-display prohibition) remains fully enforced — whatever this signal computes internally, only a discretized/named category may ever reach a live-facing output, never a raw number. `computeNightStars` already follows this shape today (`starScore` is internal-only; `stars`, 1-5, is the only externally-read field) — the new signal must preserve that same shape, not add a second raw number to the output.

## TASK 0 — Probe

Confirm fresh, in both repos — do not assume either "reuse existing HRD code" or "build from scratch" before checking:
```bash
# field-relay-nba
grep -n "function computeNightStars\|export async function recomputeNightStars" src/analytics-engine.js
grep -n "homeRunDerby\|HRD" src/index.js src/analytics-engine.js
# what does the real, current MLB Stats API HRD passthrough actually return post-event?
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/mlb-stats/homeRunDerby/839032" | head -c 2000
```
```bash
# jubilant-bassoon, read-only cross-repo check via the GitHub API (fetchRepoFile-equivalent), not assumed
# confirm buildHRDBracket / HRD_2026_VERIFIED_FINAL live here and are genuinely client-only
# (prose/prompt-context construction), with no server-side equivalent already existing
```
Read `computeNightStars` and `recomputeNightStars` in full before touching anything. Confirm exactly how `ctx.games` is assembled (`fetchContextGraph`) and whether HRD could realistically be added to that same array as a synthetic "game," or whether a separate signal path (additive to `starScore` directly, not shoehorned into the games array) is architecturally cleaner — decide based on what TASK 0 actually finds, not the doc's own guess.

## TASK 1 — Build the HRD-native drama signal

Not a retrofit of `drama_peak`/`walkoffs`/`extras` — those are win-probability/text-regex concepts with no HRD equivalent. Build signals that describe what actually happened in HRD's real structure: size of the largest deficit overcome in the final round, how many swings remained when the outcome was still genuinely uncertain, margin of final victory. Use the real, verified 2026 final (Walker 12, Schwarber 11, down 3 with 1 swing left, 4 consecutive HRs to win) as the concrete case this signal must correctly recognize as high-drama — if the new signal doesn't clearly and meaningfully move the needle for this specific, known-dramatic real event, it isn't done.

Wire as an **additive** contribution to `computeNightStars`'s existing `starScore` — same function, same output shape, not a parallel scoring system. The final output stays `stars` (1-5); nothing new gets exposed as a raw number anywhere `/analytics/night_stars/{date}` returns.

**Build this general, not HRD-specific, if TASK 0's investigation supports it without meaningfully increasing scope:** HRD is one instance of a broader category (exhibition/skills events with no natural win-probability curve — All-Star Skills Challenge, Home Run Derby, any future addition) that the current architecture structurally can't score. If a genuinely general "signature event" signal is buildable without materially expanding this CC-CMD's scope, prefer it over an HRD-only special case; if it would require substantially more investigation/design than the HRD case alone, ship HRD-specific now and note the generalization as a real, explicit follow-up rather than scope-creeping this CC-CMD trying to solve both at once.

## TASK 2 — Verify

- `node --check src/index.js` and `src/analytics-engine.js`: clean.
- **Recompute July 13 2026 for real** (`recomputeNightStars` or equivalent against the live D1 data) and confirm the new signal produces a materially higher, more accurate rating than the original 2/5 — this is the concrete proof the fix works, not just that it runs without error. Report the exact before/after `stars` and `starScore` values.
- Confirm the output shape is unchanged apart from the new contribution — no raw HRD numbers (deficit size, swings remaining, etc.) appear anywhere in the `/analytics/night_stars/{date}` response; only `stars` and the existing internal-only `starScore` change.
- Confirm a normal night with no HRD/signature event present produces byte-identical output to before this change — zero regression on the standard path.

## DONE CONDITION

Night Stars for July 13 2026, recomputed against real data, now reflects the actual drama of the Derby with a materially higher rating than the original 2/5, verified concretely (real before/after values), not asserted. The signal generalizes cleanly if TASK 0/1 supported that without scope creep, or is HRD-specific with the generalization explicitly flagged as a real follow-up if it didn't. Output shape unchanged — no new raw numbers exposed, zero regression on nights without a signature event.

**Confidence scoring:**
- TASK 0 confirms the real, current state in both repos (not assumed), makes an evidence-based architecture decision (games-array vs. additive signal) (20 pts)
- TASK 1 builds a genuinely HRD-native signal (not a `drama_peak` retrofit), correctly recognizes the real 2026 final as high-drama, wired additively into the existing `starScore`/`stars` shape with no new raw-number exposure (40 pts)
- TASK 2 real recompute of July 13 with concrete before/after values proving a materially better rating, output-shape and non-regression both confirmed (40 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
