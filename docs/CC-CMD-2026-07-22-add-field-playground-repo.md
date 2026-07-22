# CC-CMD: Add field-playground as a third valid repo for FIELD Handoff MCP tools

**Date:** 2026-07-22
**Repo:** jeffunglesbee-create/field-relay-nba (sole — this modifies the MCP
server's own source, not the playground repo's contents)
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** `src/index.js` only — the `REPO_NAMES` map, one routing bug fix,
and every tool schema's `repo` enum/description.
**Prerequisite:** `jeffunglesbee-create/field-playground` already exists
(created 2026-07-22, private, initial commit `499159c` — confirmed live,
not hypothetical).

**Why — real, confirmed gap, not a hypothetical.** Every FIELD Handoff MCP
tool (`read_file`, `commit_file`, `get_archive_url`, `get_ci_status`, etc.)
hardcodes its `repo` parameter to a two-value enum
(`jubilant-bassoon`/`field-relay-nba`). Chat has no way to target the new
playground repo through any of these tools right now. This exactly mirrors
the fix already shipped once before (2026-06-30 → 2026-07-11) when
`commit_file` was hardcoded to jubilant-bassoon only — same shape of fix,
one more repo added to the same mechanism.

**Real, honest scope acknowledgment:** the exact line numbers below are
from a direct source read done earlier today (2026-07-22) via
`get_archive_url` + local ripgrep — not from memory, not guessed. HEAD may
have moved since; the Pre-Build Probe re-confirms before anything is
edited.

**Target time:** ~20 min

---

## Do NOT Touch

- Any AI-costing phase, `analytics-engine.js`, or anything unrelated to
  the `repo` parameter plumbing in `src/index.js`.
- `field-playground`'s own contents (README.md, .gitignore) — this CC-CMD
  only makes the MCP server aware the repo exists; it does not write
  anything into it beyond the verification step below.
- `WRITE_ALLOWLIST`'s path prefixes (`docs/`, `HANDOFF.md`,
  `CODE_MAP.json`) — these are repo-agnostic path rules, not part of this
  fix; do not touch unless the probe shows otherwise.

---

## Pre-Build Probe (run FIRST — re-verify against current HEAD)

```bash
git log --oneline -5
grep -n "const REPO_NAMES" src/index.js
grep -n "REPO_NAMES\[repoKey\]\|REPO_NAMES\['jubilant-bassoon'\]" src/index.js
grep -n "const REPO_NAME " src/index.js
grep -n "repoParam = url.searchParams.get('repo')" src/index.js
grep -n "enum: \['jubilant-bassoon', 'field-relay-nba'\]" src/index.js
grep -n "toolArgs.repo === 'jubilant-bassoon' ? 'jubilant-bassoon' : 'field-relay-nba'" src/index.js
```
Confirm each of these still matches what's described below before editing.
If any has drifted, adapt to the real current code rather than forcing
this doc's line numbers onto different content.

Known state as of this doc's own read (re-verify, don't trust blindly):
- Line 153: `const REPO_NAMES = { 'jubilant-bassoon': 'jubilant-bassoon', 'field-relay-nba': 'field-relay-nba' };`
- Line 155/159: two call sites reading `REPO_NAMES[repoKey] || REPO_NAMES['jubilant-bassoon']`
- Line 167: `const REPO_NAME = 'jubilant-bassoon';` — separate constant, check
  what consumes it; may or may not need touching (see TASK 2)
- Line 8251: `const repoParam = url.searchParams.get('repo') || 'jubilant-bassoon';`
  — inside the `/repo/archive` HTTP handler that `get_archive_url` mints
  signed URLs against
- ~10 occurrences of `repo: { type: 'string', enum: ['jubilant-bassoon', 'field-relay-nba'], description: '...' }`
  across the tool schema definitions (get_ci_status, get_smoke_count,
  get_deploy_status, read_file, read_source, read_lines, commit_file,
  commit_file_patch, get_archive_url, trigger_workflow)
- Line 16198 (real bug, not a style nit): `const repo = toolArgs.repo === 'jubilant-bassoon' ? 'jubilant-bassoon' : 'field-relay-nba';`
  — a binary ternary that silently routes ANY non-jubilant-bassoon value
  (including a future typo, and today `field-playground`) to
  `field-relay-nba`. This is the one that actually matters — updating the
  enum lists alone would not fix real behavior without this.

## TASK 1 — Extend `REPO_NAMES`

```js
const REPO_NAMES = { 'jubilant-bassoon': 'jubilant-bassoon', 'field-relay-nba': 'field-relay-nba', 'field-playground': 'field-playground' };
```

## TASK 2 — Fix the real routing bug (line ~16198)

Replace the binary ternary with a real lookup through `REPO_NAMES`,
preserving existing default behavior for omitted/invalid values:
```js
const repo = REPO_NAMES[toolArgs.repo] || 'jubilant-bassoon';
```
Check whether `REPO_NAME` (singular, line ~167) is consumed anywhere as a
default distinct from this — if it's genuinely a separate default used
elsewhere (not just an unused leftover), leave it as `'jubilant-bassoon'`
(no reason to change the default), but confirm nothing downstream assumes
it's the ONLY valid repo.

## TASK 3 — Fix the `/repo/archive` handler default/validation (line ~8251)

`get_archive_url` needs to work for `field-playground` too. Confirm
`repoParam` gets validated against `REPO_NAMES` (or an equivalent list)
somewhere downstream of line 8251 — if it does, TASK 1 alone covers it. If
`repoParam` has its own separate allowlist/switch instead, add
`field-playground` there explicitly. Do not assume either way — check.

## TASK 4 — Update every tool schema's enum + description

For each of the ~10 occurrences found in the probe
(`enum: ['jubilant-bassoon', 'field-relay-nba']`), change to:
```js
enum: ['jubilant-bassoon', 'field-relay-nba', 'field-playground']
```
and update each tool's `description` string from "(jubilant-bassoon or
field-relay-nba; default jubilant-bassoon)" (or "default field-relay-nba"
for `trigger_workflow`) to "(jubilant-bassoon, field-relay-nba, or
field-playground; default jubilant-bassoon)" — keep each tool's existing
default unchanged, only the enum grows.

## TASK 5 — Real behavioral verification (in-session, not deferred)

Tool schema changes on a live MCP server are not verifiable by "the code
looks right" — a chat session's already-loaded tool definitions won't
pick up a schema change mid-session (known gap, tracked separately in
STANDARDS.md's pending MCP-tool-visibility-gap item), so this must be
verified via a raw request against the deployed endpoint, not by calling
the tool through an existing chat session:

```bash
# 1. Read verification — list/read something in field-playground:
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"README.md","repo":"field-playground"}}}' \
  | python3 -m json.tool
```
(If the real MCP endpoint path/protocol shape differs from this guess,
find the real one — check how the relay itself dispatches `tools/call`,
don't assume this exact curl works verbatim.)

```bash
# 2. Write verification — create a real, small marker file:
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"commit_file","arguments":{"path":"docs/mcp-access-confirmed.md","content":"# field-playground MCP access\n\nConfirmed working via CC-CMD-2026-07-22-add-field-playground-repo.md.\n","commit_message":"chore: confirm FIELD Handoff MCP access to field-playground","repo":"field-playground"}}}' \
  | python3 -m json.tool
```
Confirm both return real success, not a silent fallback to
field-relay-nba (check the response actually references
`field-playground`, not the other repo — this is exactly the failure
mode TASK 2 exists to prevent, so verifying it didn't happen matters more
than usual here).

## TASK 6 — Commit + outbox manifest

```bash
git add src/index.js
git commit -m "feat: field-playground as a third valid repo for FIELD Handoff MCP tools (REPO_NAMES, routing fix, schema enums)"
git push -u origin main
```
Wait for deploy, then re-run TASK 5's two curls against the LIVE deployed
URL (not a local guess) to confirm the deployed version behaves
identically. Outbox manifest per Rule 67: commit hash, deploy status, both
TASK 5 outputs verbatim, and an explicit note that this chat session's own
tool definitions will need a fresh session to pick up the new enum value
(known limitation, not a defect in this fix).

---

## Done Condition

Both TASK 5 curls succeed against the LIVE deployed MCP endpoint, and both
responses genuinely reference `field-playground` (not a silent fallback to
`field-relay-nba`). `docs/mcp-access-confirmed.md` exists as a real,
verifiable file in the `field-playground` repo afterward.

**Confidence scoring:**
+25 REPO_NAMES extended correctly (T1)
+30 The real routing bug (T2) fixed with a genuine lookup, not another
    special-cased conditional
+15 Archive-handler path (T3) confirmed covered or explicitly fixed
+15 All ~10 schema enums + descriptions updated consistently (T4)
+15 Real read AND write verification against the LIVE deployed endpoint,
    confirmed non-fallback (T5) — this is the one that actually proves it
    works, weight it accordingly

Automate follow-ups. No fallbacks, only fixes — if the MCP endpoint's real
request shape turns out to differ from the curl guesses in TASK 5, find
the actual shape (check how session_health or another tool call gets
dispatched server-side) rather than declaring verification "close enough."

Do not commit unless confidence >= 95. If score < 95, report verbatim and
stop.

---

## ONE-LINER

git pull. Read docs/CC-CMD-2026-07-22-add-field-playground-repo.md --
extend REPO_NAMES to include field-playground, fix the real routing bug at
~line 16198 (binary ternary silently falls back to field-relay-nba for any
non-jubilant-bassoon value), confirm the /repo/archive handler covers it
too, and update all ~10 tool schema enums/descriptions. Verify with real
read AND write requests against the LIVE deployed MCP endpoint -- confirm
responses actually reference field-playground, not a silent fallback.
Automate follow-ups. No fallbacks, only fixes.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
