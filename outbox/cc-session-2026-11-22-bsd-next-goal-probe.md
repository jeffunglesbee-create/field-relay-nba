# CC session 2026-11-22 — BSD Next to Score: measure it before anything is built on it

**Task:** the owner's question "what can we do with the next goal section?" (field-laboratory session, BSD docs page), then the order "probe, commit to main".
**CC-CMD:** `docs/CC-CMD-2026-11-22-bsd-next-goal-probe.md` (filed and closed in this session). **Result:** DONE, the premises that gated every use of the endpoint are answered.

## HEAD progression (field-relay-nba, branch `main`)

`483d0e7` (start) → `79d9dfc` the probe and its checks → `2137446` the CC-CMD → `a21677c` the ratchet fix → `46b953d` the rebuilt probe after review → `1c33fe9` the CC-CMD updated →
`7668eec` the run's own artifact commit → this close-out. Other sessions' commits are interleaved and not recorded here.

## What was built, per commit

- `79d9dfc` `scripts/bsd-next-goal-probe.mjs`, `scripts/check-bsd-next-goal-probe.mjs`, `scripts/check-bsd-next-goal-probe-run.mjs`, `scripts/mutate-bsd-next-goal-probe.mjs`, `scripts/fixtures/bsd-next-goal-synthetic.mjs`,
  `.github/workflows/bsd-next-goal-probe.yml` (dispatch-only), one step in `.github/workflows/guards.yml`. Nothing under `src/`.
- `a21677c` **Broke Deploy RELAY Worker from `79d9dfc` (pushed about 16:22Z) until this fix (16:41Z), about 20 minutes.** The absence-collapse ratchet counts `process.env.BSD_API_TOKEN || ''` as a new site (57 over a baseline of 56);
  the probe read the token that way, and Deploy RELAY Worker failed at that step (run 45044427433). Found by another session's message, reproduced locally (`bash scripts/absence-collapse-ratchet.sh`), fixed by removing the
  fallback instead of raising the baseline; that session dispatched Deploy RELAY Worker at 16:42Z (run 45045304015, success). The author had run 171 single-line check commands before the push and not this one: the ratchet is
  among the guards deploy.yml and guards.yml carry and is not a `check-*.mjs`. Nothing of this session's reached `src/`; the deploy carried the other session's feature commit, which had been waiting.
- **Repo guards stays red after `a21677c`, from a different step that this session did not cause:** `check-bsd-frame-contract.mjs` ends `INSUFFICIENT: 0 read(s) failed, reads capped` because its census of the relay's R2 captures
  (2,845 keys, 1,250 events read) reached its own `READ_CAP` of 2500. It passed at `483d0e7` and has failed on each run since (45045210366, 45046157321, 45056058505). This session's own guard step (the two next-goal checks) passed in those runs.
  Reported, not touched (Rule 69).
- `46b953d` after three independent adversarial reviews (below): the probe rewritten, both checks extended, the harness rebuilt to 265 mutations, the workflow reordered (commit the evidence, then judge it; the harness last; 15-minute limit).
- `1c33fe9`, then this commit: the CC-CMD (design, counts, result), this document, the HANDOFF close-out.

## The review, and what it changed

Three agents read `79d9dfc` before its first run: real-vendor shape, spend/secrets/runtime, and Rule 90 blind spots. No blocker. The shape reviewer used the committed real `events/live` capture
(`outbox/bsd-uefa-probe-20260919T161717Z.txt`) and found the first version's central error: `events/live` is not an in-play list (34 of 58 rows finished, one at halftime), so a coverage count over all rows
reported finished matches as matches without a read and printed no in-play denominator. The Rule 90 reviewer wrote 169 mutations; **135 survived the author's own 46-mutation harness**. The checks and the
harness were rebuilt until the survivors were killed or shown equivalent (one was a redundant guard, removed). The fixtures were written from the documentation and from the capture's vocabulary,
so they shared the author's assumptions until the reviewer and the real run corrected them: the real run found three more (`leader` takes `none`, `call_threshold` is 0.7, `track_record.accuracy` is a percent).

## Verified end to end, and what was not

- **Verified:** the run `45056731513` at `1c33fe9` against the real vendor, 18 requests, the relay's `BSD_API_TOKEN`: gate OPEN on both endpoints, same id space (16 of 16), coverage 16 of 17, both filters honoured,
  ledger partition holds and 73.43% against the vendor's 73.6%. Every step green, including the checks (19 scenarios / 241 assertions; 22 / 102) and the harness (265 of 265) on the runner.
  The artifact is `outbox/bsd-next-goal-probe-latest.json` (and the stamped copy), written by the run, not by hand.
- **Not verified, stated so it is not mistaken for verified:** one instant, a Sunday-evening Europe slate with no EPL, MLS or UEFA match; FIELD's own grading of a call; "beats the live market" (no next-goal price exists);
  that the ledger's event ids key FIELD's R2 captures; the plan the token is on (read from the 200, not from the account); whether the relay's edge cache or the licence permit forwarding a read (Rule 45, human).
- Rule 45: the artifact stores one verbatim row per endpoint in a public repository. Flagged for human review; not decided.

## Carry-forwards (none is deferred work of this CC-CMD)

The CC-CMD ends at the measurement. What follows is decisions, not residue: the owner rulings it lists (is a viewer-side minute poll "pull" under Rule A; may `is_call`/`call_threshold`/`calls_only` be forwarded or shown;
is SSE fan-out push; may the lab's live card go beyond "score and minute only"; the BSD call budget for a next-goal path against the 600-a-day stats-poll number; relay `src` timing after 2026-11-23; licence §4 against the
existing `/bsd/*` passthrough). The data-side next step, a lab proof grading `/calls/` against FIELD's own goal timelines, opens with a census of how many of the ledger's 1,533 calls fall in leagues FIELD captures
(2 of the 16 live reads did); it is a new CC-CMD when the owner chooses it.

## Re-run

`gh workflow run bsd-next-goal-probe.yml` (or dispatch it) during a live slate; the verdicts are in `analysis` of the artifact and the coverage line is its first printed result.
`node scripts/check-bsd-next-goal-probe.mjs`, `node scripts/check-bsd-next-goal-probe-run.mjs`, `node scripts/mutate-bsd-next-goal-probe.mjs` need no token.
