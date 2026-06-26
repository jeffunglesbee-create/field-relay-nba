# PROBE F — BSD R2 Pitch Map Smoke — 2026-06-26

## Commit

- `9d5f5c3` ci(deploy): PROBE F — BSD R2 pitch map (post-match shotmap pipeline)
- Trigger run: 28239592798 (workflow_dispatch — see "Trigger note" below)
- PROBE F result: **success** at 13:00:48Z
- Job log: `BSD R2 shotmap: 25 shots for fixture 8346` → `✅ BSD R2 pitch map pipeline healthy`

## Change

Added `PROBE F — BSD R2 pitch map` step to `.github/workflows/deploy.yml`,
inserted after PROBE E (FD standings) and before the Summary step.
`continue-on-error: false` — this is a structural check, not informational.
Fails the deploy if `FIELD_DATA` binding is removed, the `/bsd/r2/read` route
is deleted, or the fixture key disappears from R2.

Updated the Summary step copy: structural checks now reads `8` (was `7`),
adds `+ BSD R2 pitch map` to the list, and `/bsd/*` to the routes list.

## Fixture choice

`bsd/wc26/8346/stats.json` — Türkiye 2-2 USA, June 26 2026 MD3 finale.
14086 bytes, 25 shots in shotmap. Permanent R2 capture (immutable post-game),
making it a stable canary for the BSD R2 read path. The probe only asserts
`len(shotmap) > 0` — does not check exact count, so future re-captures
remain valid.

## YAML validation

```
$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"
YAML OK
```

## Trigger note

`.github/workflows/deploy.yml` itself is not in the workflow's `paths` filter
(`src/**`, `wrangler.toml`, `workers/**`), so committing the new step did NOT
auto-fire a deploy. Triggered via `mcp__github__actions_run_trigger`
(`workflow_dispatch`) to validate PROBE F end-to-end. The first src/ commit
after this will exercise PROBE F automatically.

## Done conditions

- [x] PROBE F appears between PROBE E (FD standings) and Courier/Summary
- [x] `continue-on-error: false`
- [x] YAML valid (`yaml.safe_load` passes)
- [x] Dispatched run 28239592798 — PROBE F step success at 13:00:48Z
- [x] Log output confirms `BSD R2 shotmap: 25 shots for fixture 8346`
      → `✅ BSD R2 pitch map pipeline healthy`
- [x] Summary step copy updated (8 structural checks, /bsd/* in routes)

## Negative-path verification (theoretical, not exercised)

If `FIELD_DATA` is unbound: `/bsd/r2/read` returns `503 no binding` → `curl -sf`
fails → `SHOTS=0` → `exit 1`. Deploy fails.
If `/bsd/r2/read` route is removed: catch-all returns 404 `Unknown BSD route` →
`curl -sf` fails → `SHOTS=0` → `exit 1`. Deploy fails.
If R2 key disappears: `/bsd/r2/read` returns 404 → `curl -sf` fails →
`SHOTS=0` → `exit 1`. Deploy fails.
If schema changes (no `shotmap[]`): `len(d.get('shotmap',[]))` returns 0 →
`SHOTS=0` → `exit 1`. Deploy fails.

All four failure modes are caught by the same probe.

## Compliance

- **Rule 47**: Structural data-layer check only. No editorial computation.
- **Rule 69**: Only `.github/workflows/deploy.yml` touched. One commit.
- **Rule 77**: PROBE F log output verified end-to-end against the dispatched run.
- **Rule 87**: Self-completing. Trigger executed in-session via MCP.
