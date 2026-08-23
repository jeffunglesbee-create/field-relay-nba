# The banned-phrase list banned nothing — 2026-08-23

Found by reading the output of a verification that PASSED, not by a failing check.

## The brief

Run 2 of `verify-epl-grounding`, live through `/journalism/generate`:

> "Hull City **stunned** Manchester United 2-0, a result that feels like a fever
> dream for the opening weekend."

`jubilant-bassoon/CLAUDE.md`, section *Banned Journalism Phrases*:

> Never generate content containing: "stunned", "shocked", "thriller",
> "instant classic", "for the ages", "must-watch", "can't-miss"

The verification reported VERIFIED. Everything it asserted was true — the join
resolved, no minute was claimed, no W-D-L record appeared, the scoreline was
real. It did not assert this, so it did not catch it.

## Two independent gaps, either one sufficient

**1. The list did not contain the words.** `hasCliche("Hull City stunned
Manchester United 2-0.")` returned `[]`. The relay's `BANNED_PHRASES` is a
wire-copy cliché list — "punch their ticket", "backs against the wall",
"secured a victory" — and carried **none of the seven**. The governing document
banned the word and the code had never been told.

`must-watch` was worse than absent: it sat in `SPARINGLY_PHRASES`, which permits
one use per brief. A phrase cannot be both banned outright and allowed once.

**2. The detector was wired to nothing.** `runQualityChain` never called
`hasCliche`. `src/index.js:70` imports it as `jqHasCliche` and that import is
its **only occurrence in the file** — Rule 63, dead code, in the enforcement
path of the project's most explicit content rule.

So the state was: an instruction in the style block naming every banned phrase,
a detector that would not have recognised them, and nothing calling the
detector. Three layers of nothing.

## The fix

- The seven move into `BANNED_PHRASES`, `must-watch` leaves `SPARINGLY_PHRASES`.
- **Layer 2h** in `runQualityChain` calls `hasCliche` and retries, naming the
  phrase and telling the model the fix is a concrete fact, not a quieter
  adjective — a synonym swap is the obvious way to satisfy this retry without
  satisfying the rule.
- Placed BEFORE the content layers deliberately. 2h rewrites prose, so anything
  it introduces — a fabricated figure, a cross-window comparison, a dropped stat
  — is still policed by 2f, 2g and 2d downstream. Running it last would give
  voice the final word over accuracy.

This is the same shape as layer 2f, and 2f's own comment already said why:
*"Instructions alone demonstrably did not hold, so this is enforcement."* That
sentence was written about fabricated numbers. It was equally true of banned
phrases, and nobody had checked.

## Verification

`scripts/banned-phrase-check.mjs`, 21 assertions: each of the seven present and
detected, no phrase in both lists, the measured sentence caught, a clean brief
not flagged, 2h firing inside the chain, the retry actually cleaning the text,
and a clean draft not triggering a retry at all.

`verify-epl-grounding` now asserts no banned phrase in live prose, so the next
live run fails on what this one only reported.

## What this says about the verification itself

A check that passes is not the same as a brief that is good. This one asserted
three specific absences and confirmed them correctly; the defect was in the
fourth thing nobody had thought to assert. The general lesson is not "add more
assertions" — it is that reading the artifact is part of the job, and a PASS is
where that reading starts rather than where it stops.
