# CC-CMD-2026-08-06-close-rule-registry-carryforward — Result

## Status: DONE. Outcome (a) with a real correction to the CC-CMD's own
framing — and explicitly NOT "closed by going green."

## Task 1 — what the carry-forward actually referred to

The CC-CMD suspected the carried-forward item and the green step might
be different things. **They are.** Confirmed by decoding the step and by
reading real run history, not by inference:

**The green step** — `Rule registry check -- no unregistered "## Rule N"
(N>=89)` — decoded from its base64 payload. It reads `## Rule N`
headings from jubilant-bassoon's `STANDARDS.md` and
`docs/CLAUDE-CODE-PROMPT-RULES.md`, floors at `REGISTRY_FLOOR = 89`, and
requires a matching `codex` row (`category='rule-registry'`,
`key='rule-{n}'`) via `POST /d1/execute`. **It tests existence
(registration). It contains no age or staleness logic whatsoever.**

**The carried-forward step** is a different one entirely:
`Rule 90 staleness check -- no UNEXERCISED rule-registry entry older
than 14 days`. Found by scanning failed-run history:

```
30779108185  verify  failed_steps=['Rule registry check -- ... (N>=89) ...']
30593709372  verify  failed_steps=['Rule 90 staleness check -- no UNEXERCISED ... older than 14 days']
30593199448  verify  failed_steps=['Rule 90 staleness check -- no UNEXERCISED ... older than 14 days']
```

That step **no longer exists in `deploy.yml`** (`grep`: not present at
HEAD). Removed by commit `c2d2327` (2026-07-31), which did **not** delete
the check — it moved it, unchanged (same D1 query, same pass/fail), into
the standalone non-blocking `rule90-staleness-monitor.yml`. That commit's
own message is a proper Rule 77 investigation and it explicitly refused
to fabricate cases (Rule 2).

## Task 2 — outcome (a), with the important half the CC-CMD's own
options didn't quite cover

The CC-CMD offered (a) stale / (b) real failure / (c) stale-by-design
needing exercise. The truth is **(a) for the framing, and a variant of
(c) for the substance** — and critically, **the gate cannot honestly be
made green today**:

- **The framing is stale.** "verify job continues failing on Rule-90
  staleness gate" is false and has been since 2026-07-31. Deploys are not
  blocked by it. Two consecutive HANDOFF close-outs propagated it anyway.
- **The condition is real and current.** `rule90-staleness-monitor.yml`
  has failed every run since at least 2026-08-02, including today
  (`31109175842`). Verbatim:

```
Checked 5 UNEXERCISED rule-registry entries.
RULE-90 STALENESS VIOLATIONS (UNEXERCISED > 14 days):
  rule-90: ... (updated_at=2026-07-11 18:42:03, 25.8 days old)
  rule-92: Watch Engine WC selection ... (25.7 days old)
  rule-93: OTW momentum ... (25.7 days old)
  rule-94: _fieldDataReady sentinel ... (25.7 days old)
```

- **rule-92/93/94 were left UNEXERCISED deliberately.** No work in this
  session touched the Watch Engine, OTW momentum, or the
  `_fieldDataReady` sentinel. Rule 90's own text calls an honest
  UNEXERCISED "the correct, honest signal to surface… not a false alarm
  to suppress." Flipping them to force green would be fabrication
  (Rule 2) — the same line the 2026-07-31 session drew, for the same
  three rules.
- **rule-90 itself was flipped to EXERCISED**, because a genuine case
  occurred: this very carry-forward *is* an instance of
  RULE-COMPLIANCE-FOLLOWUP-A. The mechanical artifact (daily monitor +
  codex query) held the true state while the human-propagated HANDOFF
  channel went stale and wrong — precisely the failure mode the rule
  exists to prevent. Rule 90's text requires the flip "the moment a
  session finds a real case… not deferred," so it was done, not noted.

Note the flip changes **no** CI signal (92/93/94 keep the monitor red),
so there was no incentive to overstate the case.

## Task 3 — verification artifacts

**Exercise run** [`31117941940`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31117941940) — all steps `success`. AFTER snapshot, verbatim from
the job log (full copy committed at
`outbox/rule-registry-after-2026-08-06.json`):

```
rule-90: EXERCISED -- Rule 90: 2026-08-06, RULE-COMPLIANCE-FOLLOWUP-A applied for real...
         updated_at 2026-08-06 15:58:27
rule-92: UNEXERCISED -- ... updated_at 2026-07-11 20:35:30   (untouched)
rule-93: UNEXERCISED -- ... updated_at 2026-07-11 20:35:35   (untouched)
rule-94: UNEXERCISED -- ... updated_at 2026-07-11 20:35:41   (untouched)
rule-98: UNEXERCISED -- ... updated_at 2026-08-03 02:29:35   (3 days old, not stale)
```

**HANDOFF.md diff:** a new top close-out entry that supersedes the stale
carry-forward, citing `c2d2327` and the monitor run IDs. The historical
2026-07-25/27 and 2026-07-26/27 entries were **deliberately not edited**
— they were accurate when written, and rewriting a session log to match
present knowledge would falsify the record. The new entry states both
that deploys are *not* blocked and that the staleness signal *is* still
correctly red, so the next session inherits neither error.

**Was any assertion weakened? — NO.**
- The `Rule registry check` step is untouched.
- The staleness check is untouched (it was moved on 2026-07-31, before
  this session, and this session did not alter its logic, threshold, or
  cadence).
- No rule was flipped without a genuine case; 3 of the 4 stale entries
  were left red on purpose.
- The monitor is expected to keep failing, and that is the correct state.

## Residual, disclosed

A confirming re-run of `rule90-staleness-monitor.yml`
(dispatched, run `31118236736`) had not left `queued` at write time —
GitHub Actions was in a sustained platform incident during this session
(`Failed to resolve action download info. Error: Service Unavailable`
killed three unrelated runs outright). The expected result is a
**continued failure listing 3 entries instead of 4** (rule-90 dropping
off, 92/93/94 remaining). This is a confirmation of an already-proven
D1 state change, not an open question — the AFTER snapshot above is the
authoritative evidence that the flip landed. No follow-up CC-CMD is
warranted; the monitor runs daily on its own schedule and will show the
3-entry list on its next tick.

## Outbox
This file + `outbox/rule-registry-after-2026-08-06.json`.
