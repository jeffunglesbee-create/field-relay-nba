# CC-CMD-2026-08-06-close-rule-registry-carryforward

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-06-close-rule-registry-carryforward.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The real situation: a carry-forward that may already be dead

`HANDOFF.md`'s two most recent session close-outs (2026-07-26/27
journalism-brief-history, and 2026-07-25/27 playground-secret-bootstrap)
**both** record the same blocking item, in near-identical wording:

> **CI gate note:** `verify` job continues failing on pre-existing
> Rule-90 staleness gate. Unrelated to this change — `deploy` job
> (structural probes, wrangler deploy) succeeded.
>
> ### Carry-forwards
> - Rule-90/91/92/93/94/95/96 staleness gate — separate session, still
>   pre-existing.

**But as of 2026-08-06 it appears not to be failing.** In deploy run
[`31112262449`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31112262449),
every check step in the `verify` job reported `success`, including
`Rule registry check -- no unregistered "## Rule N" (N>=89) in
STANDARDS.md or CLAUDE-CODE-PROMPT-RULES.md`. The only failing step was
`Commit results` (an unrelated push race — see
`CC-CMD-2026-08-06-deploy-verify-commit-push-race`).

This is a Rule 72 problem: an inherited claim has been carried forward
across at least two sessions without re-verification, and the evidence
now contradicts it. Either it was fixed incidentally and the
carry-forward is stale, or the thing that was failing is **not** the
step currently passing — note the carry-forward says *staleness* while
the green step checks *registration* (existence of a `codex`
`rule-registry` row), which are different properties. Do not assume
which; determine it.

## Task 1 — Probe from HEAD; determine what the carry-forward actually referred to

```bash
git log --oneline -5
grep -n "Rule registry check" .github/workflows/deploy.yml
```

The check is a base64-encoded Python payload inside the step. Decode and
read it rather than guessing at its behavior:

```bash
sed -n "$(grep -n 'Rule registry check' .github/workflows/deploy.yml | cut -d: -f1),+6p" \
  .github/workflows/deploy.yml | grep -o '"[A-Za-z0-9+/=]\{200,\}"' | tr -d '"' | base64 -d
```

Establish, from the real decoded source:
- What it actually asserts (as of `504b0e5` it reads `## Rule N`
  headings from **jubilant-bassoon**'s `STANDARDS.md` and
  `docs/CLAUDE-CODE-PROMPT-RULES.md`, floors at `REGISTRY_FLOOR = 89`,
  and requires a matching `codex` row with `category='rule-registry'`
  and `key='rule-{n}'` via `POST /d1/execute` — re-verify all of this,
  do not take it from this doc).
- Whether it checks **age/staleness** at all, or only existence. If it
  only checks existence, the HANDOFF carry-forward is describing a
  *different* gate — find that gate, or establish it no longer exists.
- Search the real run history for the last run where this step actually
  failed, and read that failure output. That is the only reliable way to
  know what was being complained about.

## Task 2 — Resolve it, one way or the other

Exactly one of these outcomes, decided by Task 1's evidence:

- **(a) The carry-forward is stale** — the gate passes and nothing is
  outstanding. Then the work is to *close it*: update `HANDOFF.md` so
  the next session does not re-inherit a dead blocker, citing the run ID
  and step conclusion that prove it.
- **(b) A real gate is still failing**, just not the one that looked
  green. Then fix it — and the fix is a real fix, not a threshold
  loosened or a check deleted to make CI green. Deleting or weakening
  the assertion to close a red gate is explicitly out of bounds; if the
  only available remedy is to weaken it, report that verbatim and stop.
- **(c) The gate is genuinely stale by design** (e.g. entries older than
  a documented window need re-exercising). Then exercise them for real
  and show the gate going green as a result.

## Task 3 — Real verification (Rule 89 — artifact required)

- The specific run ID and the `verify` job's per-step conclusions,
  quoted, showing the resolved state.
- If outcome (a): the exact `HANDOFF.md` diff removing the carry-forward,
  plus the run ID cited as justification.
- If outcome (b) or (c): a before-run showing the real failure output
  and an after-run showing the same step passing — two distinct run IDs,
  not one run described twice.
- In all cases: state plainly whether the `Rule registry check` step's
  assertion is *weaker* after this CC-CMD than before. The answer must
  be "no."

## Explicitly NOT in scope

- Do not modify `STANDARDS.md` or `docs/CLAUDE-CODE-PROMPT-RULES.md` in
  jubilant-bassoon to make this repo's gate pass. If the real fix is a
  rule-registry row, add the row; do not edit the rule text.
- Do not delete, disable, `continue-on-error`, or floor-raise the
  `Rule registry check` step.
- Do not touch the `Commit results` push race — that is
  `CC-CMD-2026-08-06-deploy-verify-commit-push-race`, deliberately
  separate (Rule 4, single concern).

## Outbox

`outbox/cc-session-2026-08-06-close-rule-registry-carryforward.md`: which
of outcomes (a)/(b)/(c) was real and the evidence for it, the run IDs,
the `HANDOFF.md` diff if any, and an explicit statement that no
assertion was weakened.
