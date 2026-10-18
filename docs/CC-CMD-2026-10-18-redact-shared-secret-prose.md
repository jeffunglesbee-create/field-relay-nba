# Claude Code Command — the shared secret is in 19 prose files of a public repo; redact them and close the ratchet

**Date:** 2026-10-18
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (credential exposure)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched.
**Unblocks:** `docs/CC-CMD-2026-10-14-archive-game-unauthenticated-write.md`, whose 2026-10-18 ruling is sequenced behind this.

---

## What was measured, 2026-10-18

This repo's own ratchet reads, on a clean tree:

```
PASS  RELAY_SHARED_SECRET (cron/self-call shared secret): at most 33 occurrence(s)
```

**That PASS is a budget of 33, not a count of zero.** `docs/exposed-secrets.sha256`
carries `33` for this entry and `0` for both ODDS keys. The guard's own failure
text says what it is: *"This is a RATCHET: a new hard-coded use is the failure."*
It exists to stop a 34th, and it is doing that correctly.

The count is exactly 33 today: the guard prints a `note: n of a declared 33`
line whenever `n < max`, and no such line appears.

**33 occurrences across 19 files**, enumerated by lowering the budget in a
throwaway clone:

| file | n |
|---|---|
| `CONTRACTS.md` | 1 |
| `HANDOFF.md` | 1 |
| `docs/CC-CMD-2026-06-21-brief-freshness-guard.md` | 3 |
| `docs/CC-CMD-2026-06-23-archive-brief-scoring.md` | 1 |
| `docs/CC-CMD-2026-06-23-backfill-brief-scores.md` | 1 |
| `docs/CC-CMD-2026-06-23-soccer-fbref-fetch.md` | 6 |
| `docs/CC-CMD-2026-07-01-automated-followup-verification.md` | 3 |
| `docs/CC-CMD-2026-07-08-night-stars-recompute.md` | 1 |
| `docs/CC-CMD-2026-07-12-jinx-drama-peak-invalidation.md` | 1 |
| `docs/CC-CMD-2026-07-21-record-streak-board.md` | 2 |
| `outbox/cc-automated-followup-verification-2026-07-01.md` | 1 |
| `outbox/cc-drama-nightstars-invalidation-2026-07-12.md` | 2 |
| `outbox/cc-night-stars-recompute-2026-07-08.md` | 2 |
| `outbox/cc-session-2026-08-02-shared-schedule-ai-cache-relay.md` | 1 |
| `outbox/cc-session-2026-08-02-undocumented-api-health-check.md` | 1 |
| `outbox/cc-session-analytics-cron-p2.md` | 1 |
| `outbox/cc-soccer-fbref-fetch-2026-06-23.md` | 3 |
| `outbox/cc-standards-rule90-mechanical-2026-07-11.md` | 1 |
| `outbox/cc-sync-reconciler-2026-06-21.md` | 1 |

All markdown. **No code** — the gate audit
(`scripts/check-relay-secret-gates.mjs`) separately reports *"every gate reads
the binding and fails closed; no literal fallback remains"*. These are prose
files that quoted the value inline while describing routes, dated June–August
2026.

**This repo is public:** `private: False, visibility: public`, read from the
GitHub API 2026-10-17. The value gates `POST /d1/execute`, a write path to the
production briefs table.

---

## What this CC-CMD does and does not achieve

**Redaction does not end the exposure.** The value is in this repo's history and
the history is public. Only rotation ends it, and rotation is the owner's
(`rotate-relay-secret.yml`, `confirm=ROTATE`, still 0 runs). Said plainly here
so that a green ratchet afterwards is not misread as safety — which is exactly
the misreading this document exists to correct.

What it does achieve: the value stops being readable in the working tree, the
budget goes to 0 so the ratchet becomes a tripwire instead of an allowance, and
the `/archive/game` gating decision becomes executable.

---

## TASK 0 — add `--list`, do not hack the manifest

Reproduce the enumeration **without** editing `docs/exposed-secrets.sha256`.
`scripts/check-exposed-secrets.mjs` already builds the per-file list in `where`
and prints it only on failure. Add a read-only `--list` flag that prints
`name → files and counts` and exits 0, and self-test it.

Lowering a budget to force a failure works, which is how the table above was
produced, but it is a technique that edits the ratchet to read it. A flag is
the fix.

**Never print, log, commit or echo the value itself** — not in output, not in a
test fixture, not in a commit message. The guard is built to never hold it
(`docs/exposed-secrets.sha256` holds hashes) and nothing added here may change
that.

---

## TASK 1 — redact

Replace every occurrence with a placeholder that cannot be mistaken for a
value and reads as deliberate. Use exactly:

```
<RELAY_SHARED_SECRET redacted 2026-10-18 — see docs/CC-CMD-2026-10-18-redact-shared-secret-prose.md>
```

**Do not delete the surrounding sentence.** These files explain how routes were
authenticated; removing the explanation to remove the value destroys the record
this project runs on. Redact the token, keep the prose.

### The hazard this task must not trip

Several of the 19 are CC-CMDs and session docs, and
`scripts/check-doc-citations.mjs` anchors a `path:line` citation to a
**backtick-quoted fragment that is a literal substring of the cited file**. If a
redacted line is serving as somebody's anchor, the citation goes bare and the
guard fails with a budget of 9.

So: run `node scripts/check-doc-citations.mjs` **before** and **after**, record
both bare counts, and if the count rises, re-anchor the affected citation to a
different line of the same file rather than lowering the budget. Lowering it
would be the fallback.

---

## TASK 2 — close the ratchet

Lower the entry in `docs/exposed-secrets.sha256` from `33` to `0`, **in the same
commit as the redaction**, as the guard's own failure text instructs. Then:

- `node scripts/check-exposed-secrets.mjs` reads `at most 0 occurrence(s)` and
  passes, with no `note: n of a declared …` line;
- `--self-test` passes;
- all three entries now read 0, so the guard is a tripwire for every pinned
  value and an allowance for none.

Also check the other two repos this session can reach. `field-laboratory`'s
guard already reports a true zero in its working tree
(*"no file in the working tree contains a known-exposed credential"*), so it
needs no redaction — only its history carries the value, at `41f0b33`. State
whether `jubilant-bassoon` has the same exposure; if it does, file it as its
own CC-CMD rather than widening this one.

---

## FORBIDDEN

- **Do not rotate.** Owner-only, a secret-store write, and a session dispatch
  of it was correctly refused before.
- **Do not print or commit the value**, including in a diff that shows the
  line's before state. Commit the redacted state; do not quote the removal.
- **Do not lower the citation budget** to absorb a bare citation this change
  creates. Re-anchor instead.
- **Do not claim the exposure is closed.** The commit message and the outbox
  entry both say rotation is still outstanding.
- No PR. Commit to `main`.

## Done condition

1. `check-exposed-secrets.mjs` reads `at most 0 occurrence(s)` for all three
   entries and passes, with `--self-test` green.
2. `check-doc-citations.mjs` bare count is the same or lower than before the
   change, recorded both ways.
3. `--list` exists, is self-tested, and prints no value.
4. An outbox entry that states, in its own words, that redaction stops the
   value spreading and only rotation ends the exposure.

## Why this is filed separately from the rotation

Rotation is one dispatch the owner makes. Redaction is 33 edits across 19 files
with a citation-guard hazard attached, and it is work a session can do now
without waiting. Bundling them would make the part nobody can do block the part
anybody can.
