# For chat: field-relay-nba outstanding

**Last verified:** 2026-07-11, directly against live repo state (git log, outbox contents, D1 codex) — not carried forward from an older summary.

## The one genuinely outstanding item

**`trigger_workflow` MCP tool** — spec: `docs/CC-CMD-2026-07-11-mcp-trigger-workflow.md`

Adds a tool letting chat trigger a stuck GitHub Actions deploy directly (`workflow_dispatch`), reusing the relay's existing `GITHUB_PAT` — no new credential, matching Rule 89 (jubilant-bassoon STANDARDS.md). Confirmed via direct outbox check: no matching completion file exists, genuinely never executed.

**Not urgent.** field-relay-nba's real deploys have fired correctly via the normal push trigger all night — confirmed repeatedly via `get_deploy_status`. This is standing recovery infrastructure for the *next* genuine stuck-deploy incident (a real `src/**`/`wrangler.toml` commit with zero matching `Deploy RELAY Worker` run for that SHA), not something currently blocked. Today's only observed `/deploy/verify` mismatches traced to scheduled crons correctly not touching `src/**` — not stuck deploys.

Also documented in jubilant-bassoon's `STANDARDS.md` → "Deploy Recovery Infrastructure Reference" section, and tracked in codex (`cc-cmd-queue`, key `mcp-trigger-workflow`).

## Confirmed done, not outstanding (don't re-investigate)

Everything else pushed to this repo tonight is verified executed, source-checked directly, not taken on a commit message's word:

- `mcp-remaining-tools-multi-repo` — every jubilant-bassoon-only MCP tool audited and extended to support both repos (`get_ci_status`, `get_deploy_status`, `get_smoke_count`)
- `nhl-nba-regular-season-continuation` — nhl-gsax wired to both playoff and regular-season crons; nba-clutch zero-count guard fixed (a live risk, not just the original ask)
- `rule89-collision-resolution` TASK 5 — CI check preventing future STANDARDS.md rule-number collisions, live and tested
- `standards-rule90` TASK 3 — Rule 90's mechanical staleness check, live and tested
- `wenttoot-actual-fix` — resolved, confirmed live
- `nhl-series-gsax-403` — explicitly closed; both original findings (403 routing bug, GSAX seasonal gating) resolved before this doc was even picked up

## How to keep this accurate

Update this file the next time a real outstanding item changes state (lands, or a new one appears) — don't let it silently go stale. If in doubt whether this file is current, cross-check against `codex_search`/`codex_list` (category `cc-cmd-queue`) rather than trusting this file blindly forever.
