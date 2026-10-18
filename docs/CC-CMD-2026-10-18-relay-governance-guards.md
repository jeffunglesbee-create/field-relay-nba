# Claude Code Command — a status may contradict its own implementation, and a close-out need not name a session doc

**Date:** 2026-10-18
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (governance guard) — no production change
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched.

---

## What happened, and why a guard rather than a correction

`docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md` read
`**Status:** NOT STARTED — not dispatched.` while **three commits cited it by
task number** — `3ad28bd` (TASK 3), `9e76e87` (TASK 4), `85a95da` (TASK 5.5) —
plus `3b2fef2` and `147f375` on the same work. The document said the work had
not begun; five commits said otherwise. Corrected by hand 2026-10-18.

Nothing caught it. `field-laboratory` has `scripts/cc-cmd-status-check.mjs`,
which caught chat's own out-of-vocabulary status yesterday. This repo has no
equivalent, so a status line can disagree with the tree indefinitely.

The same pull found the second half of Rule 67 unguarded here: a HANDOFF
close-out can land without naming a session doc, and nothing notices.

---

## Measured first, because both guards are ratchets and a ratchet needs a number

Counted 2026-10-18 at `147f375`, over `docs/CC-CMD-*.md` and `HANDOFF.md`:

| fact | count |
|---|---|
| CC-CMD files | **386** |
| …carrying a `**Status:**` line | **55** |
| …carrying **none** | **331** |
| …whose status falls outside the laboratory's vocabulary | **8** |
| HANDOFF close-out sections | **57** |
| …naming a `**Session doc:**` | **21** |
| …naming **none** | **36** |
| …naming one that **does not exist** | **0** |

Two readings of that table decide the whole design.

**First: the problem is absence, not malformation.** 331 of 386 CC-CMDs have no
status at all and 36 of 57 close-outs name no session doc. A direct port of the
laboratory's guard requires a status on every CC-CMD and would fail 331 times
on arrival. **A guard that is red before it is wired is the wallpaper failure**
`scripts/odds-coverage.mjs` documents at its own cost, and the one TASK 4 of the
CFL CC-CMD deliberately avoided by keeping its guard out of `guards.yml`. So
both of these are ratchets on the absence, with the measured number as the
budget, exactly like `docs/exposed-secrets.sha256`.

**Second: integrity where the field exists is already perfect — 0 close-outs
name a missing doc — so that half is a TRIPWIRE at 0, not a ratchet.** Two
different facts, two different budgets. Folding them into one number is the
mistake that let `RELAY_SHARED_SECRET: at most 33 occurrence(s)` read as a pass
for a count of zero.

---

## TASK 1 — `scripts/cc-cmd-status-check.mjs`, ported with this repo's vocabulary

Port the laboratory's script. Keep its two-list shape and its self-test.

**Add `RULED` to the non-terminal vocabulary.** Two of the eight
out-of-vocabulary statuses are `RULED`, both written by chat on 2026-10-18 for
`CC-CMD-2026-10-14-archive-game-unauthenticated-write` and
`CC-CMD-2026-10-14-push-cron-gambit-path`. That is a real state the
laboratory's list lacks — decided by the owner, not yet built — and this repo
has two of them. Add the word; do not rewrite the documents to fit a list that
is missing a state they legitimately occupy.

The remaining six leading words outside the vocabulary are `STOPPED` ×2,
`FALSIFYING`, `APPLIED`, `CAUSE` and `TASKS`. **Read each before deciding.**
Some are probably states worth naming; at least one (`TASKS`) looks like a
status line that is really a sentence. Judge them one at a time and report the
judgement — do not bulk-rewrite and do not bulk-admit.

Three checks, with these budgets:

1. **a status, where one exists, opens with a vocabulary word** — ratchet,
   budget set to whatever survives the reading above (8 before adding `RULED`,
   6 after).
2. **a CC-CMD carries a status line** — ratchet, **budget 331**. New CC-CMDs
   must carry one; the back catalogue is not the target.
3. **exactly one status line per document** — the laboratory's check, which has
   a real purpose: a second status further down can silently override the
   first. Expect 0; if not, that is a finding.

---

## TASK 2 — a close-out names a session doc that exists

New `scripts/check-closeout-session-doc.mjs`, two checks on `HANDOFF.md`:

1. **a close-out names a `**Session doc:**`** — ratchet, **budget 36**.
2. **every named session doc exists on disk** — **TRIPWIRE, budget 0.** All 21
   currently resolve. This half needs no grace because it has nothing to
   forgive.

Why this is the missing direction, stated precisely so the guard is not
mistaken for one that exists:

- `scripts/check-handoff-current.mjs` already covers **work → HANDOFF**: it
  fails when work lands that no close-out records, within `GRACE_DAYS`. It
  caught chat's `d1d1ad0` on 2026-10-18.
- `field-laboratory`'s `scripts/check-session-docs-indexed.mjs` covers
  **session doc → HANDOFF**: a doc that exists and is unreferenced. Its own
  header names the ambiguity it cannot resolve — *"A doc that exists and is
  unreferenced looks identical, from HANDOFF, to a session that never wrote
  one."*
- **Neither covers close-out → session doc.** That is this task.

Chat's own 2026-10-18 close-out is one of the 36 and will stay in the baseline:
it names no session doc because chat's write allowlist is `docs/`, `HANDOFF.md`
and `CODE_MAP.json`, so it cannot write `outbox/`. That is a real exemption
shape, not a violation, and the guard should not pretend otherwise. If the
reading in TASK 1 suggests chat-authored close-outs need their own marker,
report it rather than inventing one here.

---

## TASK 3 — wire them where they can fail

Both into `guards.yml`, which already fires on `docs/**`, `outbox/**` and
`**/*.md`. Both must pass on `main` the moment they land — that is what the
measured budgets are for.

Each needs `--self-test`, and each self-test must include a case that **fails**:
a fixture status outside the vocabulary, a fixture close-out naming a file that
does not exist. A ratchet nobody has watched fail is a ratchet nobody has
tested.

---

## FORBIDDEN

- **Do not require a status on all 386 CC-CMDs**, and do not add one to the 331
  that lack it. The back catalogue is history; the ratchet is for new work.
- **Do not rewrite a status to fit the vocabulary** before reading what state
  it is describing. `RULED` is the worked example: the document was right and
  the list was short.
- **Do not fold the two close-out checks into one number.** Absence and
  broken-reference are different facts and they have different budgets, 36 and
  0.
- **Do not lower a budget you have not measured**, and do not raise one to
  absorb a new violation — raising it is the failure the ratchet exists to
  catch.
- No PR. Commit to `main`.

## Done condition

1. Both scripts pass `--self-test`, each including an assertion that fails on a
   deliberately bad fixture.
2. Both pass on `main` at their measured budgets, and `guards.yml` runs them.
3. A one-line record of the judgement on each of the six remaining
   out-of-vocabulary statuses.
4. `node scripts/cc-cmd-status-check.mjs` would have failed on
   `CC-CMD-2026-10-16-cfl-archive-date-keying.md` as it read before the
   2026-10-18 correction. Demonstrate that against the old text — a guard
   written after an incident should be shown to catch that incident.

## Why both are small and still worth it

Neither guard finds a bug. They make two documents answerable: whether a
CC-CMD's stated condition matches the tree, and whether a close-out leads to the
session it summarises. This repo's protocol opens with "Read HANDOFF.md first",
and `check-handoff-current.mjs` already says what that instruction is worth —
*"that instruction is worth exactly what the document is."* These extend the
same argument one step, to the documents HANDOFF points at.
