# CC session 2026-11-25 — the ESPN reference grade after Task 2 (relay half)

**Task:** Task 2 of field-laboratory `docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md`, approved by the owner with Task 3 ("Once that is complete, task 2 and task 3 are approved"). One independent reader (a fresh read-only agent, told to attack the premises and the harness) reported; each finding was checked by a command before anything was changed. The laboratory half and the findings table: that document's "Task 2 result", and field-laboratory `outbox/cc-session-2026-11-25-espn-core-v2.md`. **No `src/` change, no deploy.**

## What changed here (field-relay-nba, `main`)

- `scripts/espn-task0-lib.mjs`: `summaryEventId(json)`, the event id a summary says it is for (`header.id` as text, null when absent). Check 78 → 81 assertions, harness 77 → 84 of 84.
- `scripts/espn-reference-grade.mjs`:
  - **The summary's event id is compared with the one asked for.** Counted matched / absent / differing (nothing recorded whether `header.id` is present, so the run measures it); a differing one is refused ("200 other event"), an absent one is not.
  - **A read that did not answer 200 or 404 makes the run not a result** (a 5xx, a timeout, a body that is not the summary, a directory with no league): those matches are unread, not "no timeline". A 404 is ESPN saying it has no such event and stays "no timeline".
  - **The core's numbers are added up again** (the first grade's runner does it; this one trusted `partitions: true`): population, graded, agree plus disagree, the reasons, and every column of the directory table.
  - Matches that share one ESPN id are counted (both); `timelinesRead` (which counted summaries in the shape, not usable timelines) is now `summariesRead`, and the usable-timeline count is the core's.
- `scripts/check-espn-reference-grade-run.mjs`: 49 → 69 assertions, **73 of 73 mutants caught** (was 50). The stub world now has distinctive BSD and ESPN ids, so the leak test searches for them (the reader showed the old test matched only exactly-quoted ids), a call that is away and a miss (the reader showed a hard-coded home and hit survived), a 500 with a valid body, a 502 with an HTML body, an event id that differs, a numeric one, shared ids, and a table of seventeen fake cores that each add up wrongly in one place (the harness showed my first table did not isolate its cases: the check had to be made to fail each rule by itself).

## Verified, by a command each

- Lab core check 119 assertions and harness 122 of 122; this repository's lib check 81 and harness 84 of 84; run check 69 assertions and harness 73 of 73 (controls pass in each); `check-bsd-e2-reach-probe` 27 assertions; `check-bsd-next-goal-grade-run` 126; the absence-collapse ratchet OK.
- The laboratory's verify, deploy and live-check on `af3500da` (the core): green.

## Found by the harness on my own new code

Four checks of the partition rule duplicated each other or the explicit census ties; the duplicates were removed rather than kept as dead terms, and the three that cannot differ for any input are listed in the harness header (an ESPN stop is also a read that is not 200 or 404; `String()` on an id the lib already makes text; per-column integer terms implied by the sums).

## Open, and said so

- **The guard for a capture with no full-time row is one-sided** (the laboratory's session doc). The run reports it; it does not hide it.
- The run itself (Task 3), ESPN's own-goal convention, `header.id` presence and a shootout flag in the header rows remain unmeasured until it has run.

## Task 3: the run, and its result (2026-11-25, owner-approved)

Run 45689623116 (`espn-reference-grade.yml`, dispatched on `main` at `5e2e62a`, `lab_ref` `af3500da353d8bc0fba26398d595e8b97c65365b`): `verify` (7 minutes: every check and harness, no secret), `grade` (3 minutes: the token, no write credential) and `commit` all succeeded; "A grade that left something out is not a result" passed. Artifact: `outbox/espn-reference-grade-latest.json` (and the stamped `espn-reference-grade-2026-11-25T20-00-34-834Z.json`): `reachedTarget` true, `stopped` null, `analysisError` null.

- **382 gradeable calls on 246 matches; graded 268, agree 268, disagree 0, not applicable 114** (the 57 UEFA matches the join does not look at, 89 calls; the 19 EFL Championship matches with no archive rows, 25 calls).
- **170 ESPN summaries read, all HTTP 200, the event id on each matched the one asked for (170 of 170), no ESPN id shared.** 170 of 170 usable timelines.
- Step A on 170 matches: identical 148, cut short 22, different in number, order or minute 0. 267 of 268 graded calls resolve at 0 minutes from the ledger's `resolved_minute`, 1 at 1 minute. Own goals: ESPN's row carries the side credited (21 of 21).
- **E5 says what this means:** ESPN and BSD's capture never differ on these 170 matches, so this cannot tell an independent confirmation from one provider's feed licensed to both. The full table and the limits (the one-sided guard on 161 captures, the vacuous k=0 join check, the 22 cut-off captures): field-laboratory `docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md`, "Task 3 result".
- Public artifact scanned for ids, names and the token: none.

**Integration state (Rule 65):** relay contract unchanged (reads `/context/date`, `/bsd/r2/*`); VERIFIED end to end by the run. Nothing is STAGED.
