# CC-CMD-2026-08-02-ruwt-baseline-audit

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-ruwt-baseline-audit.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

Relay capability has grown meaningfully this session — Cloudflare
Browser Rendering, two new scheduled health/drift-detection workflows,
D1 write access from those workflows. Each addition was individually
scoped and reasoned about at the time. This is the deliberate,
periodic check that the *aggregate* is still RUWT/ADR-002 compliant —
new capability makes it easier to drift into a violation by accident,
not intent, as the surface area grows.

## Task 1 — Re-read the actual, current governing text fresh

Read `ADR-002-CONTEXT.md`'s real, current Rule F (commodity vs.
proprietary) and Rule A (pull vs. push) text at HEAD — do not work
from memory of what these rules say, including any prior session's
paraphrase.

## Task 2 — Audit every current relay route and scheduled workflow against Rule A specifically

For every route and every `schedule:`-triggered workflow in this repo
(list them from HEAD, don't assume the list from memory):
- Confirm each route only ever *responds* to a pull/request — never
  autonomously sends a value-based alert unprompted.
- For scheduled workflows specifically (drift-detector,
  undocumented-api-health-check, and any others found): confirm each
  one's only externally-visible action on an unhealthy result is
  writing a detection record (e.g. to `codex`) — never pushing a
  notification, webhook, or alert to any external consumer. Detection-
  only, matching both new workflows' own stated design.

## Task 3 — Audit against Rule F where relevant

For any route that computes or derives a value (not just proxies raw
upstream data), confirm it still passes the "would a neutral vendor
publish this" test, or is correctly client-only if not.

## Task 4 — Report findings, do not remediate in this CC-CMD

If everything audited is genuinely compliant, state that plainly with
the real evidence per item — a clean audit is a real, useful result,
not a null one. If anything is found to be drifting or ambiguous,
flag it clearly with specifics, but do not modify it as part of this
CC-CMD — a real RUWT question deserves its own, focused CC-CMD, not a
fix bundled into an audit.

## Task 5 — Smoke + verify

- Confirm this repo's real current quality gate (checked fresh, not
  assumed) passes.

---

## Explicitly NOT in scope

- Do not modify any route or workflow based on this audit's findings.
- Do not audit jubilant-bassoon's client-side scoring logic — this is
  relay-only, matching where RUWT's push/pull boundary actually lives.

---

## Outbox

`outbox/cc-session-2026-08-02-ruwt-baseline-audit.md`: the real,
current list of every route/workflow audited, with a specific
pass/flag verdict and evidence for each.
