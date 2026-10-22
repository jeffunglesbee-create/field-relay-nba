# Relay governance guards: CC-CMD status lines, and close-outs that name their session doc

CC-CMD: `docs/CC-CMD-2026-10-18-relay-governance-guards.md`. Date 2026-10-22.
HEAD `cb187f6c` → `3fbcbb5d`.

| commit | what |
|---|---|
| `782dd236` | three CC-CMD status lines open with the state they describe |
| `48cd06bd` | `scripts/cc-cmd-status-check.mjs`, ported, plus `RULED`, `APPLIED` and `STOPPED` |
| `fb925833` | `scripts/check-closeout-session-doc.mjs` |
| `3fbcbb5d` | `guards.yml` runs both |

## Measured first, at 3adb159

**CC-CMDs.** 402 files, 71 with a status line and **331 without**, the same
331 as at `147f375`: all 16 new CC-CMDs since then carry a status. With
`RULED` added, **6** statuses fall outside the vocabulary, exactly the six the
CC-CMD named. 0 documents have more than one status line. 0 are open at the
top and closed further down.

**Close-outs.** 60 `## SESSION CLOSE-OUT` sections. **The CC-CMD's 36 was a
parsing artifact.** Reproduced exactly at `147f375` (57 close-outs, 21 with a
bold `**Session doc:**` line, 36 without), it reads only the bold form at the
start of a line. HANDOFF uses seven forms:

- the plain `Session doc: outbox/…`, which is the form Rule 67 itself
  prescribes;
- `**Session doc:**`;
- mid-line after the HEAD line, with the path on the next line;
- `Session doc, per Rule 67:` and `**Session doc (Rule 67):**`;
- plural lists, once after a blank line;
- a glob;
- a path in another repo.

Read in every form, `147f375` had **4** close-outs naming none and `3adb159`
has **6**, each read by hand:

- **Name nothing:** 2026-10-21, 2026-08-29, 2026-08-27.
- **Chat's close-outs:** 2026-10-19 (chat), 2026-10-18, 2026-10-16. Chat's
  write allowlist excludes `outbox/`, the exemption the CC-CMD named.

**0** named docs are missing. The first draft of the parser found 3 "missing";
all three were artifacts cited beside the session doc (a `.json` glob, a
`.log`, a CC-CMD path). Rule 67 says a session doc is
`outbox/cc-session-…md`, so only `outbox/*.md` and outbox globs count.

## Judgement on the six out-of-vocabulary statuses

1. `08-15-quality-bar-scale`: "falsifying test ANSWERED … one sub-question
   remains open". The ask is **OPEN**: `OPEN —` prefixed, wording kept.
2. `09-15-cfb-opening-odds-gap`: "CAUSE FOUND", above a "Done condition —
   MET" section. It is **DONE**: `DONE —` prefixed, wording kept.
3. `09-15-capture-provenance-mark`: **APPLIED** is a real terminal state, a
   data change applied and verified. Admitted to the vocabulary.
4. `10-10-bsd-form-into-forecaster`: "STOPPED AT TASK 1 … by this document's
   own stop". **STOPPED** is a real terminal state. Admitted.
5. `10-11-hockey-wp-moneypuck-baseline`: the same. Covered by STOPPED.
6. `10-11-nhl-wpa-attribution`: "TASKS 1, 2, 3 AND 5 DONE … STOPPED AT TASK 4"
   is a sentence whose state is STOPPED. Reordered so `STOPPED AT TASK 4`
   leads, wording kept.

## The guards

`cc-cmd-status-check.mjs`:

- carries a status: **ratchet at 331**;
- opens with a vocabulary word: **tripwire at 0**;
- exactly one status line: **tripwire at 0**;
- not open above a closing section: **tripwire at 0**;
- non-vacuity.

`check-closeout-session-doc.mjs`:

- names a session doc: **ratchet at 6**;
- every named doc exists: **tripwire at 0**;
- non-vacuity.

The two facts are reported as two numbers. An outbox glob counts if it matches
a file. Another repo's path or a Drive id counts as named and is reported as
not checkable here (one: 2026-08-15, jubilant-bassoon's outbox).

## Proven to fail

- **Done condition 4.** On `docs/` at `f521e6d5^`, `cc-cmd-status-check.mjs`
  exits 1 naming `CC-CMD-2026-10-16-cfl-archive-date-keying.md: "NOT STARTED —
  not dispatched."`. The same text is also a self-test fixture.
- **Self-tests:** 11 cases in the status check and 18 in the close-out check.
  Each includes cases that must fail: the CFL fixture, a ratchet one over
  budget, a close-out naming a missing file, and a sentence-shaped status.
- **Mutations, run against the self-tests:**
  - Caught: the tripwire made never to fire, vocabulary matched anywhere in
    the line, the ratchet disabled.
  - Survived, then fixed: removing the "not written" branch. The fixture could
    not see it, because the `.md` filter already discarded its path. A fixture
    citing an `.md` beside "not written" was added, and the mutation was then
    caught.
- **Defects found by the self-test while writing it:**
  - the first parser read "Chat cannot write outbox/." as the doc `outbox/.`;
  - a list after a blank line (2026-10-10) read as absent.

  Both were fixed before commit.

## Also run

`workflow-yaml-check` (186 files, 0 failing), `check-doc-citations`,
`check-exposed-secrets` and `check-handoff-current` all exit 0.

## The limit, filed rather than carried

The status guard catches the CFL incident only because `NOT` is outside the
vocabulary. A `FILED` status with commits already doing its tasks would pass.
That is now `docs/CC-CMD-2026-10-22-status-vs-citing-commits.md`
(Rule 87.4).
