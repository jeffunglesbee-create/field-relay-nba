# Claude Code Command — Close the two Rule 89 scoped-tool gaps found live tonight

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole — this adds/extends MCP tools, which live in the relay)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** one small extension (Task 1), one new tool (Task 2). Two single-concern commits, not one.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/rule89-scoped-tools-2026-07-13.md.

## CONTEXT — why this exists

Tonight (2026-07-13), a chat session shipped 4 real code changes under a
genuine live-event clock (fieldOperation real-pilot + 3 Home Run Derby
fixes, jubilant-bassoon) by cloning both repos with the raw `GITHUB_PAT`
(located via conversation_search of past chats) and using `git`/`curl`
directly, rather than the scoped MCP tools (`commit_file`, `read_file`,
`get_ci_status`/`get_deploy_status`). This was flagged as a real Rule 89
violation (STANDARDS.md, jubilant-bassoon) — see codex `rule-89` for the
full incident — and Rule 89 now has a new operational rule 4 naming
live-event/time-pressure as a sanctioned exception category, *provided*
the underlying scoped-tool gap still gets closed afterward. This CC-CMD
is that closure, per direct user instruction ("needs to exist for live
events and under pressure situations").

Two real, distinct gaps caused the deviation:

1. **Large-file commits.** `commit_file`'s `content` parameter requires
   the full new file body as a literal string. jubilant-bassoon's
   `index.html` is ~810KB / ~43K lines; field-relay-nba's `src/index.js`
   is ~810KB / ~14K lines. Round-tripping either through a session's
   context on every edit is expensive enough that the session used
   `git clone` + local `str_replace`-style edits + `git push` instead.
2. **Compact Actions-run diagnostics with trigger event.** `get_ci_status`/
   `get_deploy_status` already exist and already return a compact,
   multi-run summary (`name | conclusion | sha | updated_at`) — this
   gap is narrower than it first looked. What's actually missing is the
   `event` field (push vs workflow_dispatch vs schedule), which the
   session needed repeatedly tonight to diagnose whether a deploy fired
   via its normal push trigger or a manual dispatch (see the
   `deploy_match` false-positive root-cause work earlier tonight). The
   session used raw `curl` + the GitHub Actions API's own `event` field
   instead of extending the existing tool.

**Do not build a third, broader tool "just in case."** Rule 89 operational
rule 3 already prohibits a generic proxy. Scope is exactly these two gaps.

## TASK 0 — Probe

Read the current, real definitions and handlers fresh before touching
anything (do not trust this doc's line numbers — they will drift):

- `grep -n "toolName === 'get_ci_status'" src/index.js` and read the
  full handler (confirm the exact current output line format before
  changing it).
- `grep -n "toolName === 'commit_file'" src/index.js` and read the full
  handler, plus its tool definition block, plus the `fetchRepoFile`,
  `isPathAllowed`, `repoApiFor`/`repoNameFor` helpers it calls.
- `grep -n "WRITE_ALLOWLIST" src/index.js` — confirm the current
  allowlist contents; Task 2's new tool must respect the identical
  allowlist, not a looser one.
- Confirm current tool-count / naming doesn't already have anything
  named `commit_file_patch` or similar (avoid a collision).

## TASK 1 — Add `event` to get_ci_status / get_deploy_status output

Single-line change to the existing handler's map/join: include
`run.event` in the compact output string, e.g.
`` `${run.name} | ${run.event} | ${run.conclusion || run.status} | ${run.head_sha?.slice(0,7)} | ${run.updated_at}` ``
(confirm the real field name is `event` on the GitHub Actions API
response fresh — TASK 0's probe, not assumed from this doc).

Update both tool definitions' `description` strings to mention the new
field is included. No inputSchema change — this is output-shape-only,
fully backward compatible (existing callers parsing the string just see
one more `|`-delimited field).

**Verify:** call the live `/mcp` endpoint (or the existing
`get_deploy_status` MCP tool if reachable from this session) against a
repo with recent mixed-trigger runs (field-relay-nba has both push and
workflow_dispatch runs from tonight) and confirm the event field is
correct for at least one push-triggered and one workflow_dispatch-
triggered run, not just present.

Commit 1, single concern: this task only.

## TASK 2 — New tool: commit_file_patch (find/replace edits, no full-content parameter)

Add a new MCP tool, `commit_file_patch`, that commits an update to an
**existing** file (not file creation — `commit_file` already covers
create) via a list of `{old_str, new_str}` edit operations applied
server-side against the file's current live content, mirroring the
safety semantics of the chat session's own `str_replace` tool exactly:

- Input schema: `path` (string, required), `repo` (enum, default
  jubilant-bassoon, same as commit_file), `edits` (array of
  `{old_str: string, new_str: string}`, required, min 1), `commit_message`
  (string, required), `parent_sha` (string, required — this tool only
  ever updates an existing file, so parent_sha is not optional the way
  commit_file's is for the create case).
- Handler: reuse `fetchRepoFile`/`isPathAllowed`/`repoApiFor` exactly as
  `commit_file` does (TASK 0's read of that handler is the reference,
  not a rewrite). Verify `parent_sha` matches live sha (same staleness
  check as commit_file). Apply each edit **sequentially** against the
  in-memory content: for each `{old_str, new_str}`, confirm `old_str`
  occurs **exactly once** in the current working content (count
  occurrences; 0 or 2+ is a hard error naming which edit index failed
  and how many occurrences were found — do not guess which one was
  meant), then replace. Reject the whole request (no partial commit) if
  any edit in the list fails its uniqueness check — this must be
  all-or-nothing, matching str_replace's own one-edit-at-a-time safety
  contract applied across a batch.
- After all edits apply cleanly in memory, PUT the resulting full
  content the same way `commit_file`'s existing PUT logic already does
  (reuse, don't reinvent) — the file content itself still crosses the
  relay↔GitHub boundary as it always has; what changes is that it never
  needs to cross the session↔relay boundary as a session-supplied
  literal, only the small edit snippets do.
- Response shape: same as commit_file's success response, plus an
  `edits_applied: N` count.

**Verify for real, not mocked:** pick a real, low-risk existing file
(e.g. this very outbox doc once TASK 3 writes it, or a scratch file
created and immediately used for this test) and perform a real 2-edit
patch through the new tool end-to-end, confirming both edits landed
correctly and the commit is real (visible via a normal `read_file` of
the same path afterward). Confirm the uniqueness-rejection path for
real too: attempt an edit whose `old_str` matches 0 times and confirm a
clean, specific error naming the failing edit index — not a generic
500 or a silent no-op.

Commit 2, single concern: this task only (plus its own tool-definition
addition in the same commit — schema and handler are one concern here,
splitting them would leave an inert, undispatchable tool definition
in main for one commit).

## TASK 3 — Verify + outbox

- Both new/changed tools confirmed working against real repo state, not
  assumed from the diff.
- Confirm zero behavior change to any existing tool call — `commit_file`
  itself must be byte-for-byte unchanged; only `get_ci_status`/
  `get_deploy_status`'s output string format gained one field.
- Outbox manifest: both commit hashes, the real verification transcript
  (not paraphrased) for both tasks, and an explicit note that these
  tools will not appear in *this* CC-CMD's own tool list (MCP tool
  lists are fixed per-session) — a fresh session is required to actually
  call them for the first time.

## DONE CONDITION

`get_ci_status`/`get_deploy_status` report the real trigger event
alongside existing fields, confirmed against a real mixed-trigger repo.
`commit_file_patch` exists, is confirmed live via a real end-to-end
patch (including a real rejected-uniqueness case), and requires no
full-file-content parameter for an update. Zero regression to
`commit_file` or any other existing tool.

**Confidence scoring:**
- TASK 0 confirms real current handler/schema text and allowlist, not
  guessed from this doc (15 pts)
- TASK 1 correct, minimal, verified against a real mixed-trigger repo (20 pts)
- TASK 2 correct all-or-nothing multi-edit semantics, reuses existing
  helpers rather than reinventing, real end-to-end verification
  including the rejection path (45 pts)
- TASK 3 real verification transcript, zero regression confirmed,
  honest note about tool-list availability timing (20 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.
