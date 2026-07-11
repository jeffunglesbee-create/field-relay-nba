# Claude Code Command — MCP: add workflow_dispatch trigger tool, reusing the existing GitHub connection

**Date:** 2026-07-11
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Scope:** field-relay-nba is currently stuck: a real commit (`494d53b`) has never deployed. `GET /deploy/verify` confirms it directly: `{"expected":"494d53b","deployed":"dbfc400","match":false}`. The MCP server already has a fully working, authenticated connection to `api.github.com` (proven every time `commit_file`/`read_file` run tonight) — this CC-CMD adds one more endpoint call on that same connection, not new infrastructure.
**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md and STANDARDS.md Rules 80/81 before touching this file.

Write findings to outbox/cc-mcp-trigger-workflow-2026-07-11.md.

## CONTEXT — confirmed directly, re-verify from HEAD before building

- `commit_file`'s handler (`src/index.js`) already does `const ghToken = env3.GITHUB_PAT;` and calls `ghHeaders(ghToken)` to build authenticated GitHub API requests. This is the exact pattern to reuse — same token, same header helper, same base auth approach. Do not invent a new auth path.
- `.github/workflows/deploy.yml` confirmed to have both triggers:
  ```yaml
  on:
    push:
      branches: [main]
      paths: ['src/**', 'wrangler.toml', 'workers/**']
    workflow_dispatch:
  ```
  `workflow_dispatch` takes no required inputs — a bare `{"ref":"main"}` body is sufficient.
- The stuck commit `494d53b` almost certainly hit the `[skip ci]` suppression documented elsewhere in this project (a push-trigger commit with `[skip ci]` in the message never fires, even if it touches a watched path). This CC-CMD does not need to diagnose that further — it needs to add the capability to manually catch up when it happens, since it will happen again.
- Repo owner/name: `jeffunglesbee-create/field-relay-nba` — reuse whatever repo-resolution pattern TASK 2 of the earlier multi-repo CC-CMD established (`repoApiFor`/`REPO_NAMES`), do not hardcode a second, separate constant.

## TASK 1 — Re-verify against actual HEAD

Confirm `commit_file`'s exact auth pattern, `deploy.yml`'s exact trigger config, and the repo-resolution helper from the earlier multi-repo fix are all still exactly as described above. Report any drift before proceeding.

## TASK 2 — Add `trigger_workflow` MCP tool

New tool, same JSON-RPC registration pattern as the existing tools:

- Input: `{ workflow_file: string (e.g. "deploy.yml"), ref?: string (default "main"), repo?: string (jubilant-bassoon|field-relay-nba, default field-relay-nba since that's the primary use case, but must support both) }`
- Handler: `POST {repoApiFor(repo)}/actions/workflows/{workflow_file}/dispatches` with body `{"ref": ref}`, using the exact same `ghHeaders(ghToken)` pattern `commit_file` already uses.
- GitHub returns `204 No Content` on success. Return `{ ok: true, workflow_file, repo, ref, triggered_at: <ISO now> }` on 204. On any non-204, return the real status code and response body verbatim — do not swallow the error.
- No new credential, no new allowlist concept needed — this reuses the existing `GITHUB_PAT` and existing repo-resolution logic entirely.

## TASK 3 — Live verification: actually use it to fix the real stuck deploy

This is not a synthetic test. Use the newly-built tool to call `trigger_workflow({ workflow_file: "deploy.yml", repo: "field-relay-nba" })` for real, against the actual current stuck state.

Then poll `GET /deploy/verify` (already exists, no changes needed) every ~15s for up to 2 minutes, until either `match: true` or the attempt is confirmed to have failed. Report the real before/after `expected`/`deployed` values — do not just report that the tool call returned `ok: true`, confirm the deploy actually completed and matched.

## VERIFICATION

- `trigger_workflow` tool genuinely added, using the exact existing auth pattern (confirm via source read, not assumption).
- Called for real against field-relay-nba's `deploy.yml` — not simulated.
- `GET /deploy/verify` confirmed to show `match: true` after the run completes, with `deployed` now equal to `494d53b` (or whatever the current HEAD is by execution time, if something else lands first — the point is `expected == deployed`, not a specific hash).
- Confirm the tool also works with an explicit `repo: "jubilant-bassoon"` call (even if there's nothing currently stuck there) — a dry confirmation that the 204 path works cross-repo, not just for field-relay-nba.

## DONE CONDITION

`trigger_workflow` exists, reuses the existing GitHub connection with no new credential, and has been used to genuinely resolve the real stuck deploy confirmed at the start of this CC-CMD — `/deploy/verify` shows `match: true` afterward, verified live. Confidence ≥ 95.

**Confidence scoring:**
- TASK 1 re-verification against actual HEAD, drift reported honestly (15 pts)
- `trigger_workflow` correctly reuses existing auth/repo-resolution patterns, no new credential introduced (25 pts)
- Real, live trigger call made against the actual stuck deploy, not simulated (25 pts)
- `/deploy/verify` confirmed `match: true` after completion, polled live (25 pts)
- Cross-repo call (jubilant-bassoon) confirmed working too (10 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.