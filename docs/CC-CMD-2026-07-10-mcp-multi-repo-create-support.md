# Claude Code Command — FIELD Handoff MCP: multi-repo + create-file support

**Date:** 2026-07-10
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY — this is where the MCP server lives, in `src/index.js`)
**Scope:** The FIELD Handoff MCP tool surface (`read_file`, `read_source`, `read_lines`, `commit_file`) is hardcoded to a single repo and cannot create new files. Both limitations block the standing CC-CMD workflow, which requires chat to push new spec docs to whichever repo the work targets.
**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md and STANDARDS.md Rules 80/81 before touching this file — this handler is the sole holder of GITHUB_PAT for every chat session. Treat it accordingly.

Write all findings to outbox/cc-mcp-multi-repo-create-2026-07-10.md.

## CONTEXT — extracted from the deployed Worker bundle tonight, RE-VERIFY AGAINST ACTUAL HEAD BEFORE CHANGING ANYTHING (deployed code and current git HEAD are not guaranteed identical)

Current state, `src/index.js`, near the top:

```js
var REPO_OWNER = "jeffunglesbee-create";
var REPO_NAME = "jubilant-bassoon";
var REPO_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
var READ_ALLOWLIST = [
  "index.html", "src/", "docs/", "scripts/", ".github/",
  "CODE_MAP.json", "HANDOFF.md", "STANDARDS.md", "README.md", "CLAUDE.md"
];
var WRITE_ALLOWLIST = ["docs/", "HANDOFF.md", "CODE_MAP.json"];
function isPathAllowed(path, allowlist) {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/")) return false;
  return allowlist.some((prefix) => path === prefix || path.startsWith(prefix));
}
```

Every read/write tool builds its GitHub API call from the single `REPO_API` constant — this is not commit_file-specific, it's foundational. `read_file`, `read_source`, `read_lines`, `commit_file`, and `get_archive_url` are all scoped to jubilant-bassoon only as a direct consequence.

The `commit_file` handler, in full, as currently deployed:

```js
if (toolName === "commit_file") {
  const ghToken = env3.GITHUB_PAT;
  if (!ghToken) return respond(jsonrpc2({ content: [{ type: "text", text: "GITHUB_PAT not configured on worker" }], isError: true }));
  const { path, content, commit_message, parent_sha } = toolArgs;
  if (typeof path !== "string" || typeof content !== "string" || typeof commit_message !== "string" || typeof parent_sha !== "string") {
    return respond(jsonrpc2({ content: [{ type: "text", text: "Required: path, content, commit_message, parent_sha (all strings)" }], isError: true }));
  }
  if (!isPathAllowed(path, WRITE_ALLOWLIST)) {
    return respond(jsonrpc2({ content: [{ type: "text", text: `Path not in WRITE_ALLOWLIST: ${path}` }], isError: true }));
  }
  const live = await fetchRepoFile(ghToken, path);
  if (!live.ok) {
    return respond(jsonrpc2({ content: [{ type: "text", text: `Live read failed: ${live.status} ${live.error}` }], isError: true }));
  }
  if (live.sha !== parent_sha) {
    return respond(jsonrpc2({ content: [{ type: "text", text: `Stale parent_sha: caller has ${parent_sha}, live is ${live.sha}. Re-read and retry.` }], isError: true }));
  }
  const utf8 = unescape(encodeURIComponent(content));
  const b64 = btoa(utf8);
  const msg = commit_message.includes("[skip ci]") ? commit_message : `${commit_message} [skip ci]`;
  const putR = await fetch(`${REPO_API}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(ghToken), "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg, content: b64, sha: parent_sha, branch: "main" })
  });
  ...
}
```

Two independent bugs in this one handler:
1. `fetchRepoFile` 404 (the file doesn't exist — the *expected* state for a create) is treated identically to a real failure. There's no branch that recognizes "doesn't exist yet" as valid create-intent.
2. The PUT body always includes `sha: parent_sha`, unconditionally. Per GitHub's Contents API, omitting `sha` entirely means create; including any `sha` value means update. This code can never reach a real create even if the 404 branch were fixed, because the sha field always gets sent.

**Prior art already in this same file, not currently wired to the MCP surface:** `checkIncidentThresholds` (the incident-draft watcher) has its own hardcoded constant — `ANOMALY_WATCHER_REPO_API = "https://api.github.com/repos/jeffunglesbee-create/field-relay-nba"` — proving the two-repo pattern already exists here, just not generalized.

## TASK 1 — Re-verify against actual HEAD

Confirm every constant and function above still matches current `src/index.js` exactly (grep for `REPO_API`, `WRITE_ALLOWLIST`, `READ_ALLOWLIST`, `isPathAllowed`, `fetchRepoFile`, `commit_file`, `ANOMALY_WATCHER_REPO_API`). Also grep for every other call site that references `REPO_API` directly (read_file/read_source/read_lines/get_archive_url handlers) so TASK 2 doesn't miss one. Report any drift from what's quoted above before proceeding.

## TASK 2 — Parameterize repo selection

Replace the single `REPO_OWNER`/`REPO_NAME`/`REPO_API` globals with a resolver, following the existing `ANOMALY_WATCHER_REPO_API` naming precedent rather than inventing a new pattern:

```js
var REPO_OWNER = "jeffunglesbee-create";
var REPO_NAMES = { "jubilant-bassoon": "jubilant-bassoon", "field-relay-nba": "field-relay-nba" };
function repoApiFor(repoKey) {
  const name = REPO_NAMES[repoKey] || REPO_NAMES["jubilant-bassoon"]; // default preserves all existing callers' behavior
  return `https://api.github.com/repos/${REPO_OWNER}/${name}`;
}
```

Add an optional `repo` string parameter (enum: `jubilant-bassoon` | `field-relay-nba`, default `jubilant-bassoon`) to the inputSchema for `read_file`, `read_source`, `read_lines`, `commit_file`, **and `get_archive_url`**. Every existing caller that omits `repo` must behave byte-identically to today — this is the hard backward-compatibility bar, verify it explicitly.

**`get_archive_url` is in scope, not deferred.** An earlier version of this spec left it out as a stretch item. That was wrong: read access to field-relay-nba turned out to be at least as urgent as write access — a same-night diagnosis (wentToOT root-cause investigation) was blocked entirely by having no read path to relay source, not just no write path. `get_archive_url` mints an HMAC-signed, short-TTL URL for the target repo's tarball — this is the Rule-80-intended pattern (signed URL, not raw credential) and is likely the *fastest* of the four tools to generalize, since it's one function returning one URL rather than a live GitHub API round-trip per call. Prioritize this one first within Task 2 if the tasks end up sequenced.

## TASK 3 — Fix commit_file: real create support

Restructure the create/update branch as follows (adapt as needed once TASK 1's re-verification is in):

```js
const { path, content, commit_message, parent_sha, repo } = toolArgs;
// parent_sha is now OPTIONAL. path/content/commit_message remain required.
const repoApi = repoApiFor(repo);
const live = await fetchRepoFile(ghToken, path, repoApi);
let shaForPut;
if (live.ok) {
  // file exists -- this is an update, same strictness as before
  if (!parent_sha || live.sha !== parent_sha) {
    return respond(jsonrpc2({ content: [{ type: "text", text: `Stale or missing parent_sha for existing file: caller has ${parent_sha || "(none)"}, live is ${live.sha}. Re-read and retry.` }], isError: true }));
  }
  shaForPut = parent_sha;
} else if (live.status === 404) {
  // file does not exist -- this is a create
  if (parent_sha) {
    return respond(jsonrpc2({ content: [{ type: "text", text: `Path does not exist (404) but parent_sha was supplied. Omit parent_sha to create a new file, or re-check the path.` }], isError: true }));
  }
  shaForPut = undefined;
} else {
  return respond(jsonrpc2({ content: [{ type: "text", text: `Live read failed: ${live.status} ${live.error}` }], isError: true }));
}
...
const body = { message: msg, content: b64, branch: "main" };
if (shaForPut) body.sha = shaForPut; // omitted entirely on create
```

Update the tool's `description` and `inputSchema` text so `parent_sha` reads as optional-for-create/required-for-update, and document the new `repo` parameter.

## TASK 4 — Probe whether field-relay-nba needs its own allowlists

Check whether field-relay-nba has its own `HANDOFF.md`/`CODE_MAP.json`-equivalent files worth write-protecting the same way jubilant-bassoon's are, or whether `docs/` alone is sufficient for that repo (recall from tonight: field-relay-nba has no separate HANDOFF copy today — its work gets recorded in jubilant-bassoon's HANDOFF instead). Don't assume the same WRITE_ALLOWLIST applies unmodified to both repos — confirm from the actual field-relay-nba repo structure.

## TASK 5 — Explicit repo-guard test

Add a real live test proving a `commit_file` call with `repo: "field-relay-nba"` cannot write to jubilant-bassoon or vice versa — this is a security boundary, not just a routing convenience, and needs its own assertion, not an inference from the happy path working.

## VERIFICATION (all live, against real repos — this handler is credential-bearing, code review alone is not enough)

- Create a real new file in field-relay-nba/docs/ via the fixed tool (no parent_sha), confirm it lands, confirm content matches exactly.
- Update that same file via the fixed tool (with the real parent_sha this time), confirm the update path is unchanged in behavior from before this change.
- Attempt a create with a stale/wrong parent_sha supplied — confirm it's rejected, not silently treated as a create.
- Confirm every pre-existing caller pattern (omit `repo`, always supply `parent_sha`) still works identically against jubilant-bassoon — this is the regression risk that matters most.
- Confirm the repo-guard test from TASK 5 passes.

## DONE CONDITION

`commit_file`, `read_file`, `read_source`, `read_lines`, AND `get_archive_url` can all target either repo via an optional `repo` parameter, defaulting to jubilant-bassoon for full backward compatibility. `commit_file` can create new files in either repo's WRITE_ALLOWLIST without a parent_sha, while update behavior for existing files is unchanged in strictness. `get_archive_url` for field-relay-nba returns a working signed URL that a live `web_fetch`/`curl` can actually pull real source content from — this must be tested end-to-end (mint URL, fetch it, confirm real repo content comes back), not just confirmed to return a URL shape. All verified live, not just read from source. Confidence ≥ 95.

**Confidence scoring:**
- TASK 1 re-verification against actual HEAD, drift reported honestly if found (10 pts)
- Multi-repo parameterization complete across all FIVE relevant tools (including get_archive_url), zero missed REPO_API call sites (20 pts)
- Create-file path verified live in field-relay-nba (20 pts)
- Existing update-path behavior confirmed byte-identical for pre-existing callers (20 pts)
- `get_archive_url` end-to-end for field-relay-nba: URL minted, fetched, real source content confirmed (15 pts)
- Repo-guard cross-write test passes (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

---

**One-liner:**
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-10-mcp-multi-repo-create-support.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
