# MCP trigger_workflow Tool — 2026-07-11

## TASK 0 — PAT `workflow` Scope Check

Real, live check performed (temporary GitHub Actions workflow, since
this session's sandbox has no direct route to `api.github.com`):
`GET /repos/jeffunglesbee-create/field-relay-nba` using the same
`RELAY_GH_PAT` secret confirmed earlier tonight to be the exact PAT
synced into the relay's own `GITHUB_PAT` env var.

```
x-oauth-scopes: repo, workflow
x-accepted-oauth-scopes: repo
```

**`workflow` scope is present.** Confirmed via the real response
header, not assumed. Proceeded to TASK 1/2 as instructed.

## TASK 1 — Re-verification, With One Material Correction to the CC-CMD's Own Premise

Confirmed accurate, via direct source read:
- `commit_file`'s auth pattern (`const ghToken = env.GITHUB_PAT`,
  `ghHeaders(token)` at line ~12793) — unchanged, exactly as cited.
- `deploy.yml`'s trigger config — `push` on `src/**`/`wrangler.toml`/
  `workers/**` plus a bare `workflow_dispatch:` with no required
  inputs — exactly as cited.
- `repoApiFor`/`REPO_NAMES` resolver — present, unchanged, exactly as
  cited.
- `/deploy/verify` route — exists exactly as described, no changes
  needed.

**Real drift found, in the CC-CMD's central claim, not its technical
citations:** the CC-CMD's CONTEXT section states commit `494d53b` is
"stuck" and attributes this to `[skip ci]` suppression. Checked both
parts directly:

```
git show --stat 494d53b --format=""
 .github/workflows/wenttoot5-verify.yml      |  13 ---
 outbox/cc-wenttoot-actual-fix-2026-07-11.md | 122 +++++++++++++++++++++++++++-
```

`494d53b` touches **zero** files under `src/**`, `wrangler.toml`, or
`workers/**` — it's an outbox-doc + workflow-cleanup commit. Its
message contains no `[skip ci]` string either (checked directly). Both
halves of the CC-CMD's stated diagnosis don't apply to the example it
cites: `deploy.yml`'s `push` trigger's own `paths:` filter is *why*
this commit correctly, intentionally never fired a new deploy — the
same way none of this session's many outbox-only or workflow-cleanup
commits tonight have. `/deploy/verify`'s `match: false` in that
situation isn't evidence of a stuck pipeline; it's the tool doing
exactly what it's built to do (compare literal HEAD-of-main against
the last *successful deploy.yml run's* commit) whenever the most
recent commit(s) don't touch a deploy-relevant path — which is
extremely common and not itself a problem. Confirmed this is the
live, current state too: right before TASK 2/3's work, `/deploy/verify`
showed `expected: 51e6baa` (a workflow-only commit), `deployed: 76f4e71`
(a real, already-correctly-deployed src change) — same pattern, same
non-issue.

**This does not make TASK 2 pointless.** `trigger_workflow` is
independently useful, well-scoped infrastructure regardless of whether
this specific cited example was a real incident — manually re-firing a
workflow (for a commit that legitimately doesn't touch a watched path,
or after a real `[skip ci]` suppression elsewhere, or just to re-run a
transient failure) is a genuine, reusable capability. Built and
verified it for real; reporting the premise correction honestly
alongside that, per Rule 77 (investigate, don't accept a given
narrative uncritically) and Rule 72 (inherited claims must be
independently re-verified).

## TASK 2 — `trigger_workflow` Tool

Added to the `tools/list` schema and as a new `toolName === 'trigger_workflow'`
handler, positioned immediately after `get_archive_url` (same file
region as the other L5 repo tools):

- Input: `{ workflow_file: string, ref?: string (default "main"), repo?: "jubilant-bassoon"|"field-relay-nba" (default "field-relay-nba") }`
- **Default repo is `field-relay-nba`**, not `jubilant-bassoon` like
  every other L5 tool — matches the CC-CMD's explicit spec, since
  manually re-firing this repo's own `deploy.yml` is the stated
  primary use case.
- Handler: `POST {repoApiFor(repo)}/actions/workflows/{workflow_file}/dispatches`
  with body `{"ref": ref}`, using the exact same `ghHeaders(ghToken)`
  helper `commit_file`/`read_file` already use — no new credential, no
  new repo-resolution pattern, confirmed via source read (both
  functions are defined earlier in the same enclosing scope, already
  in scope at the new handler's location).
- On `204`: `{ ok: true, workflow_file, repo, ref, triggered_at }`.
- On any non-204: real HTTP status + response body returned verbatim,
  not swallowed.

## TASK 3 — Live Verification

All four calls made for real via a temporary GitHub Actions workflow
hitting the deployed `/mcp` JSON-RPC endpoint (`FIELD_MCP_SECRET` CI
auth path) — none simulated:

**1. Real manual dispatch, field-relay-nba/deploy.yml:**
```
{"ok":true,"workflow_file":"deploy.yml","repo":"field-relay-nba","ref":"main","triggered_at":"2026-07-12T02:17:09.441Z"}
```

**2. Live poll of `/deploy/verify`, every 15s:**
```
BEFORE:  expected=e23d45a deployed=874f139 match=false runId=29176477207
[15s]    expected=e23d45a deployed=874f139 match=false runId=29176477207
[30s]    expected=e23d45a deployed=874f139 match=false runId=29176477207
[45s]    expected=e23d45a deployed=874f139 match=false runId=29176477207
[60s]    expected=e23d45a deployed=874f139 match=false runId=29176477207
[75s]    expected=e23d45a deployed=e23d45a match=TRUE  runId=29176539726
```

**The strongest evidence in this verification:** `e23d45a` (the commit
that was HEAD at the moment of the manual trigger) is itself a
workflow-only commit that touches no `src/**` path — it would **never**
have triggered `deploy.yml` via the normal `push` trigger. The new
`runId` (`29176539726`, distinct from the natural deploy's
`29176477207`) is direct, real proof a genuinely new dispatch fired and
completed, deploying current HEAD despite the path filter that would
otherwise have skipped it entirely. This is exactly the tool's intended
value, demonstrated live, not asserted.

**3. Cross-repo dry confirmation, jubilant-bassoon:** dispatched
`layout-diag-probe.yml` (read first to confirm it's genuinely
side-effect-free — a Playwright layout probe that writes a
`[skip ci]`-tagged diagnostic to `outbox/`, no deploy/production
impact):
```
{"ok":true,"workflow_file":"layout-diag-probe.yml","repo":"jubilant-bassoon","ref":"main","triggered_at":"2026-07-12T02:18:27.583Z"}
```
Real `204`, cross-repo `repoApiFor` resolution confirmed working, not
just for the default repo.

**4. Real error path, not swallowed:** dispatched a deliberately
nonexistent `workflow_file`:
```
{"isError":true,"text":"GitHub dispatch failed: 404 {\"message\":\"Not Found\",...}"}
```
Confirms the "return the real status/body verbatim" requirement from
TASK 2, not just the happy path.

## Cleanup

Temporary `.github/workflows/{pat-scope-check,trigger-workflow-verify}.yml`
both deleted after their respective verifications succeeded.

## Confidence Score

```
+15  TASK 0: real scope check performed and reported -- x-oauth-scopes:
     repo, workflow, confirmed via the actual response header, not
     assumed present or absent
+10  TASK 1: re-verification against actual HEAD confirmed every
     technical citation accurate; found and reported a real, material
     drift in the CC-CMD's own central premise (494d53b was never
     "stuck" -- it's an outbox-only commit outside deploy.yml's own
     path filter, and contains no [skip ci] either, so neither half of
     the CC-CMD's stated diagnosis applies to its own cited example)
     rather than silently building around an inaccurate narrative
+20  trigger_workflow correctly reuses the exact existing ghHeaders/
     GITHUB_PAT auth and repoApiFor resolution -- confirmed via source
     read that both are already in scope at the new handler's
     location, no new credential or pattern introduced
+20  Real, live trigger call made against field-relay-nba's actual
     deploy.yml -- not simulated, confirmed via a real triggered_at
     timestamp and (below) a genuinely new run ID
+25  /deploy/verify polled live, confirmed match:true after completion
     -- with the strongest possible evidence of genuine effect: the
     triggering commit (e23d45a) would never have deployed via the
     normal push trigger at all (workflow-file-only, no src/** touch),
     and the new runId differs from any prior natural deploy run
+10  Cross-repo call (jubilant-bassoon) confirmed working -- a real
     204 dispatch of a verified side-effect-free diagnostic workflow,
     not a synthetic/mocked check
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits

- `874f139` — the real fix: `trigger_workflow` tool added (TASK 0-2)
- `51e6baa` — temporary pat-scope-check workflow (TASK 0)
- `c186e8f`, `e23d45a` — temporary trigger-workflow-verify workflow (TASK 3)
- (this commit) — both temporary workflows removed, this outbox
