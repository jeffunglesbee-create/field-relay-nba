# CC session 2026-11-22 — how much of BSD's next-goal ledger FIELD's own goal timelines can grade

**Task:** the owner's reply `Census` to the offer after the probe: count the vendor's ledger calls that sit on a match whose FIELD capture covers the call from its minute through its resolution. Counts only, no verdict about the vendor.
**CC-CMD:** `docs/CC-CMD-2026-11-22-bsd-next-goal-ledger-census.md` (filed and closed in this session). **Result:** DONE. **370 of 1,746 calls (21.2%) are gradeable.**

## HEAD progression (field-relay-nba, branch `main`)

`be873ae` (start, the probe's close-out) → `f9c52e3` the census, its checks and harness → `2e175c8` the CC-CMD → `6d06e7b` the first run's artifact (withdrawn rule) → `f23b1d3` the corrected coverage rule →
`17180f5` the CC-CMD updated → `5b34600` the second run's artifact → this close-out. Other sessions' commits are interleaved and not recorded here.

## What was built, per commit

- `f9c52e3` `scripts/bsd-next-goal-census.mjs`, `scripts/check-bsd-next-goal-census.mjs`, `scripts/check-bsd-next-goal-census-run.mjs`, `scripts/mutate-bsd-next-goal-census.mjs`, `scripts/fixtures/bsd-next-goal-census-synthetic.mjs`,
  `.github/workflows/bsd-next-goal-census.yml` (dispatch-only), one step in `.github/workflows/guards.yml`. It imports four helpers from the probe; the probe was not modified. Nothing under `src/`.
  The absence-collapse ratchet was run before the push this time (two stub-server fallbacks in the run check removed first: `|| 0` and `|| ''`).
- `f23b1d3` **a correction, found after a green run**: the first rule read a live `period` row's `minute` as the capture's clock. The run reported 370 gradeable with 0 failing the coverage test while 234 of 246 captures were in play.
  The zero was the evidence: the committed real captures show period-row minutes are nominal (HT 45 beside a 4-minute injury time, FT 90 for a match at 96, a live `Second half` row of 90 on a 0-0 capture of a match that finished 1-0), and the second run's own artifact
  shows all 234 live rows say 90. The rule could not fail. The premise was written into the script's header as fact from one example and was never measured; the fixtures were built to agree with it; every check and 175 mutants passed on it.
  It is now: a call is covered by a capture that saw full time, or that holds a goal within 1 minute of `resolved_minute`; the live row's minute is tallied and never used; the nearest-goal distance is tallied by capture state; the count at tolerance 0, 1, 2 is printed beside the headline.
- `17180f5`, then this commit: the CC-CMD (premises, definitions written before the run, the withdrawn first number, the result), this document, the HANDOFF close-out.

## Verified end to end, and what was not

- **Verified:** run `45065701482` at `17180f5` against the real vendor and the real relay: 11 BSD requests of 16, 246 relay reads, ledger COMPLETE (1,746 reported at both ends, 0 duplicates), R2 COMPLETE (2,857 keys), verdict ANSWERED, all steps green including the checks (10 scenarios / 96 assertions; 15 / 62) and the harness (193 of 193) on the runner.
  The artifact is `outbox/bsd-next-goal-census-latest.json`, written by the run, not by hand; it is equal to the stamped file.
- **A cross-check that came out the same by an independent route:** the first rule and the second both gave 370. They are independent (one never looks at a goal row, the other looks only at goal rows), and the second shows 370 of 370 at distance 0 from the nearest goal, so the equality is a result, not the old rule surviving.
- **Not verified:** that the ledger's `outcome` is computed from the same incident feed as FIELD's captures (inferred from the 370 of 370 exact minutes); that a gradeable row carries the called minute and side a grade needs (not counted); any grade of any call.
- Rule 45: no ledger row, team, player or event id is in the artifact. Nothing flagged beyond the probe's sample-row flag, which stands.

## Carry-forwards (none is deferred work of this CC-CMD)

The grading proof is filed as `field-laboratory/docs/CC-CMD-2026-11-22-bsd-next-goal-grade-against-field-timelines.md` (Rule 87.4): it is a verdict on the vendor and the census was ordered counts-only, so it is filed, not started, and it names the two things only the owner unblocks
(that the proof may run; where the ledger token lives, because the laboratory's scripts and workflows do not reference `BSD_API_TOKEN` and no run here can read whether its repository holds the secret).
The 1,355 calls in leagues FIELD does not track are a finding for the owner (`bsd-live-capture-path` owns what the relay captures).

## Re-run

`gh workflow run bsd-next-goal-census.yml`; the coverage line is the first printed result and `analysis.calls` in the artifact holds the counts. The three checks and the harness need no token.
