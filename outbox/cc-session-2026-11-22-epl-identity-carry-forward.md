# Session 2026-11-22: docs/CC-CMD-2026-09-11-epl-identity-resolve.md carried forward

Session: https://claude.ai/code/session_01CggeNbCfJwZGqP88Ttq7r2
Trigger: the owner's status question on this CC-CMD, then "Carry forward" (2026-11-22), after "The forecaster should be for laboratory".
HEAD progression: relay `bd4a6c7d` -> `28177d71` (the feature) -> the docs commit that carries this file. Companion work in field-laboratory, below.

## What was found before anything was built

- The CC-CMD has no `Status:` line (the 10-11 queue-reconciles CC-CMD already noted this), was never executed, and the laboratory's forecaster CC-CMD retracted its wait on it. It is now PARTIAL with a status line.
- Defect 1 was already resolved, by `7191291f` (2026-10-27), not by this CC-CMD. Premise tested by command, not by reading: a read-only SELECT of `field-archive` (34 distinct EPL names, 135 rows) through `resolveTeamKey` gives 23 keys and no unresolved spelling.
- **Defect 2's rule as written does not work.** "Reached via a CANONICAL entry = RESOLVED" calls all six wrong-sport CFB schools and both benign aliases RESOLVED, because all eight are alias hits. Measured against the resolver, not inferred (`scripts/check-team-key-substitution.mjs`, section G keeps it as a guard). Building it as written would have cleared the wrong rows this diagnostic exists to find, so it was built to the CC-CMD's stated intent with a discriminator that works. This is a deviation from the text and is said so in the CC-CMD.
- An earlier lead of mine, that `Nott Forest` was an unresolved D1 spelling, was a spelling I chose and not one D1 holds. Refuted by the same SELECT.

## What was built

| where | what |
|---|---|
| field-relay-nba `28177d71` | `classifySubstitution` in `src/identity-resolver.js`; `/identity/mismatches` returns `key_resolved`, `key_substituted`, `key_unchecked` and `corroborated` per entry |
| same commit, checks | `check-team-key-substitution` 59 -> 78; `check-identity-route-join` 41 -> 50 (the real worker, `outbox/fixture-cfb-2026-09-12.json`, EPL rows added, section J12) |
| same commit, mutations | 25 -> 35 in place, each red by its named assertion; 32 -> 41 on a copy |
| field-laboratory | `scripts/epl-alias-coverage-check.mjs` (Task 2), its self-test 28/28, `scripts/mutate-epl-alias-coverage.mjs` 19 of 19, a drift-sentinel step with a read-only relay checkout, a verify step, the browser guard's pin 72 -> 73 |

## Verified, and how

- The whole relay guard set was run on the commit: 237 commands from `deploy.yml` and `guards.yml`, the read-only ones in parallel and the in-place mutators serially. Six failed. Four fail identically on a clean `origin/main` worktree (`check-archive-date-keying`, `check-bsd-frame-contract` exit 3, `check-queue-partition --live`, `check-sport-canonicaliser --live`: this sandbox has no route to workers.dev). Two were not regressions: `check-provenance-stamp-stability` rewrites a manifest and failed only under the parallel run (6/6 alone); `check-empty-catches` was my extraction cutting its multi-line arguments (with `--baseline=112 --require=... --control` it holds at 112 on both trees).
- The laboratory check, end to end with its real script and the relay's real resolver, against a local stub serving recorded real names: covered, exit 0; FPL route down, NOT MEASURED, exit 1; no resolver, exit 2. With the relay's real resolver from just before `7191291f` it exits 1 on exactly `C Palace` (orphan) and `Crystal Palace` (unseen): Defect 1, reproduced by the real thing.

## STAGED, with unblock criteria (Rule 74)

The new fields on the DEPLOYED route. Blocked by the route being gated and billed. Unblocked by the scheduled Saturday probe, next 2026-11-28 23:40Z; the exact assertion, tested to fail on the 11-22 payload and pass on a correct one, is in the CC-CMD. EPL is not in that probe's sports, so the EPL case rests on the local worker run.

The laboratory check's first run on LIVE routes is the drift sentinel's. Unblock: dispatch `drift-sentinel` after the laboratory landing, or the next scheduled run.

## Not met, named

"Re-run `/identity/mismatches` for three matchdays, payloads verbatim": billed and gated, and a standing instruction in this session forbids Odds calls. Unblock: the owner authorizes up to 9 credits, or accepts the Saturday probe. Everything Defect 1 needed from that reading was obtained from the D1 read, the census route and the resolver.

## Integration state (Rule 65)

Relay contract: `GET /identity/mismatches?date=&sports=` (gated), report gains `key_resolved`, `key_unchecked` (numbers) and per-entry `corroborated` (true, false, null); `key_substituted` is now the uncorroborated count and, for each distinct sport requested, the three add up to its old value (a sport named twice has one entry). `key_unchecked` is 0 today. Consumers: none outside this repo (searched the other three). Status: BUILT, proven locally; deployed reading STAGED.

## Independent review before the push (40 agents, 18 findings, 7 confirmed by both skeptics)

Four read-only reviewers with different lenses and two skeptics per finding. Confirmed and fixed: the cross-sport (`alsoIn`) clause had no route-level test (J12 now covers it; three mutants J39-J41 were each shown red); the STAGED assertion could not tell the corrected rule from the literal one and its "expected" sentence did not match the recorded payloads (the assertion gained a check and the sentence now says what it proves and cannot); two scenarios shared the id J6 (renamed J12, moved to the end) and one label said the opposite of its assertion; the EPL fixture pairings were presented as measured and are constructed (now stated); handler-scan regexes could be satisfied by a trailing comment (now anchored to the start of a code line, mutation M34); wording on `key_unchecked` and on "add up" (now precise). In the laboratory: the live path and exit status were not under any mutation, a red run left no annotation, and an empty archive window right after the season flips would have gone red for weeks every summer; see the laboratory session doc.

Not acted on: findings the skeptics refuted or judged intended (feed date-blindness, a feed that read little still reading covered). The census totals quoted in the CC-CMD were read with the probe tool and are re-runnable, not committed.
