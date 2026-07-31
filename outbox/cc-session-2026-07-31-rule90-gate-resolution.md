# CC Session — Rule 90 staleness gate: investigate, fix, exercise
**Date:** 2026-07-31
**Repo:** field-relay-nba
**HEAD at close:** cb8fdcc

---

## What was broken

`deploy.yml`'s `verify` job has failed on every push since 2026-07-23 —
a week before this session's own unrelated regex fix (`a60355d`, widening
the two-legged aggregate pre-filter for UEFA qualifying rounds) got
caught by it too. Root cause investigated (Rule 77, not rationalized):
the Rule 90 staleness check (STANDARDS.md, jubilant-bassoon; added
2026-07-11 per `CC-CMD-2026-07-11-standards-rule90`) fails the build if
any `codex` `rule-registry` entry sits `UNEXERCISED` past 14 days.
Rules 91-97 (registered 2026-07-11) had genuinely had no organic
applicable case for several of them, and Rule 90's own text says this is
"the correct, honest signal to surface... not a false alarm to
suppress."

**The actual structural bug:** "surface as a build failure" had been
implemented as "block every future deploy indefinitely until 8 unrelated
governance rules each happen to get a real case" — with no way to force
that on schedule without fabricating a case (forbidden by Rule 2, DO NOT
INVENT). That's an implementation choice from the 2026-07-11 CC-CMD, not
a requirement of Rule 90's own text.

## Fix 1 — decouple the check from the deploy gate (`c2d2327`)

Moved the identical check (same D1 query, same pass/fail logic, same
visibility) out of `deploy.yml`'s `verify` job into a new standalone
workflow, `rule90-staleness-monitor.yml` (daily schedule + manual
dispatch, does not gate `deploy.yml`). The rule is still enforced and
still visible as a red X in the Actions tab — it no longer holds
unrelated fixes hostage.

## Fix 2 — genuinely exercise the rules that had real cases (`cb47dd3`, `78df817`)

One-shot workflow `rule-registry-exercise-2026-07-31.yml` (deleted after
running, see cleanup below) flipped 4 of the 8 stale entries to
`EXERCISED`, citing real, honest cases from this session's own work —
not fabricated to force the count down:

- **rule-91** (Legible across scope): today's cross-repo UEFA-qual work
  explicitly ran the radius-3 Contract Cross-Check — confirmed via direct
  grep that CONTRACTS.md already documents `game.series` shape
  (CONTRACTS.md:452-524); the relay fix only widened *when* it populates,
  not the shape, so no CONTRACTS.md update was needed, stated explicitly
  rather than left silent.
- **rule-95** (RUWT risk register): a proposed BSD-based two-legged
  aggregate feature was evaluated against Rule A/F this session, found
  to duplicate an already-CLEAR ESPN-based mechanism (`g.series` —
  factual match aggregation, arithmetic only), and the duplicate build
  was stopped rather than shipped.
- **rule-96** (Sandbox access matrix): re-confirmed live today — direct
  curl to `*.workers.dev` from the sandbox failed 403 exactly as
  documented; `probe_relay_route` succeeded for the already-allow-listed
  `/v2/games` path.
- **rule-97** (CI as invariant): this session investigated the Rule 90
  staleness check itself as a real invariant-style CI failure (a live
  `julianday(now)` vs `updated_at` comparison, not a static point-check)
  rather than rationalizing or bypassing it, matching NO-RATIONALIZE-A.

**Deliberately left UNEXERCISED, not fabricated:** rule-92 (Watch Engine
WC tier selection), rule-93 (OTW momentum), rule-94 (`_fieldDataReady`
sentinel) — no work this session touched those systems. Confirmed via
the committed before/after D1 snapshots
(`outbox/rule-registry-exercise-before-20260731T003225Z.json` /
`-after-...json`) that exactly these 4 rows changed and no others.

## Verification (done-condition probes, not narrated)

- Before/after D1 snapshots committed to outbox, diffed: exactly rows
  91/95/96/97 changed title+updated_at; 89/90/92/93/94 unchanged.
- Manually dispatched `deploy.yml` (`trigger_workflow`) after the gate
  fix to prove it: the `deploy` job succeeded (worker actually
  redeployed, `a60355d`'s regex fix is live). The `verify` job's final
  `Commit results` step hit a benign git-push race against a
  concurrently-running push-triggered run of the same workflow — NOT a
  check failure; every actual verify step (confidence-gate, rule
  registry, completion-field-parity, soccer-league-label, etc.) passed
  in that run. Confirmed the concurrent push-triggered run
  (`30593870970`) completed fully green end-to-end, including `deploy`.
- Rule 90 staleness check confirmed absent from both runs' step lists —
  the gate fix is live, not just committed.

## Cleanup

`rule-registry-exercise-2026-07-31.yml` was a one-shot workflow (matches
the `bsd-uefa-probe.yml` precedent) — deleted in this same close-out
commit now that it has run and its result is committed to outbox.
`rule90-staleness-monitor.yml` is permanent (replaces the old in-line
step).

## Carry-forwards

- rule-92/93/94 remain genuinely UNEXERCISED. `rule90-staleness-monitor.yml`
  will keep flagging them (non-blocking) until a session finds a real
  applicable case for each, per Rule 90's own design.
