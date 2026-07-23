# CC-CMD: field-playground gets unrestricted commit_file writes

**Date:** 2026-07-23
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** `isPathAllowed()` and its two call sites in `src/index.js` only.

**Why — real, confirmed gap, not a hypothetical.** Tried to write
`README.md` to `field-playground` (root) via `commit_file` and got
`Path not in WRITE_ALLOWLIST: README.md`. `WRITE_ALLOWLIST` (`docs/`,
`HANDOFF.md`, `CODE_MAP.json`) was designed for jubilant-bassoon and
field-relay-nba specifically — the comment above it says so directly:
"Tighter than READ because writes mutate production." `field-playground`
is explicitly NOT production (see its own `docs/OPERATING-MODE.md`,
committed 2026-07-22 — nothing there ships to FIELD's production
surface). The narrow fix would be adding `'README.md'` to the shared
list; the correct fix is recognizing field-playground was never meant to
inherit a production-repo restriction in the first place, and giving it
none — while leaving the other two exactly as tight as they've always
been. Do not just patch around the one path that happened to get hit
first.

**Target time:** ~15 min

---

## Do NOT Touch

- The `WRITE_ALLOWLIST` array's contents for jubilant-bassoon /
  field-relay-nba — stays exactly `['docs/', 'HANDOFF.md',
  'CODE_MAP.json']`, unchanged.
- The path-traversal/absolute-path checks in `isPathAllowed`
  (`path.includes('..')`, `path.startsWith('/')`) — these are basic
  safety, not production-protection, and apply to field-playground too.
  Do not relax them for anyone.
- `get_archive_url`'s `/repo/archive` handler, `REPO_NAMES`, or anything
  else touched by the earlier field-playground CC-CMD
  (`CC-CMD-2026-07-22-add-field-playground-repo.md`) — this doc is
  additive to that work, not a redo of it.

---

## Pre-Build Probe (run FIRST — re-verify against current HEAD)

```bash
git log --oneline -5
grep -n "const WRITE_ALLOWLIST" -A 5 src/index.js
grep -n "function isPathAllowed" -A 6 src/index.js
grep -n "isPathAllowed(path, WRITE_ALLOWLIST)" src/index.js
```
Known state as of this doc's own read (re-verify, don't trust blindly):
- Lines ~184-190: `WRITE_ALLOWLIST` array + comment, immediately preceded
  by `isPathAllowed`'s definition at line ~192.
- Two call sites, ~line 16062 (inside `commit_file`'s handler) and
  ~line 16121 (inside `commit_file_patch`'s handler), both:
  `if (!isPathAllowed(path, WRITE_ALLOWLIST)) { return respond(...'Path
  not in WRITE_ALLOWLIST: ${path}'...); }`

## TASK 1 — Make `isPathAllowed` support an unrestricted mode

```js
function isPathAllowed(path, allowlist) {
    if (typeof path !== 'string' || path.length === 0) return false;
    if (path.includes('..')) return false;
    if (path.startsWith('/')) return false;
    if (allowlist === null) return true;
    return allowlist.some(prefix => path === prefix || path.startsWith(prefix));
}
```
Only the new `if (allowlist === null) return true;` line is added — the
traversal/absolute-path checks run unconditionally, before that branch,
for every repo including field-playground.

## TASK 2 — Make both call sites repo-aware

At both ~16062 and ~16121, replace:
```js
if (!isPathAllowed(path, WRITE_ALLOWLIST)) {
```
with:
```js
if (!isPathAllowed(path, repo === 'field-playground' ? null : WRITE_ALLOWLIST)) {
```
Confirm `repo` is already the resolved value (post `REPO_NAMES` lookup,
per the earlier CC-CMD's TASK 2 fix) at both call sites, not
`toolArgs.repo` directly — if the variable name or scoping differs from
this at either site, use whatever the real resolved repo variable is
there, not a re-derived one.

## TASK 3 — Update both tool descriptions

Both `commit_file` and `commit_file_patch` schema descriptions (lines
~15238 and ~15253) currently say "Path must be in WRITE_ALLOWLIST (docs/,
HANDOFF.md, CODE_MAP.json)." Append: ", except field-playground, which
accepts any path" (adjust grammar to fit each description's exact
existing sentence).

## TASK 4 — Real behavioral verification (in-session, not deferred)

```bash
# 1. Confirm field-playground now accepts a root-level path:
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"commit_file","arguments":{"path":"WRITE-ALLOWLIST-TEST.md","content":"verified\n","commit_message":"chore: confirm unrestricted write access","repo":"field-playground"}}}' \
  | python3 -m json.tool

# 2. Confirm jubilant-bassoon is UNCHANGED -- this must still fail:
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"commit_file","arguments":{"path":"SHOULD-BE-REJECTED.md","content":"x\n","commit_message":"test","repo":"jubilant-bassoon"}}}' \
  | python3 -m json.tool
```
Test 1 must succeed and genuinely land a file at `field-playground`'s
root (verify via a follow-up `read_file`, then delete/clean it up if
you'd rather not leave a test artifact — your call, not required). Test
2 MUST still return the WRITE_ALLOWLIST error — if it doesn't, the fix
leaked into production repos and that is a real regression, not a bonus.

## TASK 5 — Commit + outbox manifest

```bash
git add src/index.js
git commit -m "feat: field-playground writes are unrestricted via commit_file; jubilant-bassoon/field-relay-nba WRITE_ALLOWLIST unchanged"
git push -u origin main
```
Wait for deploy, re-run both TASK 4 curls against the LIVE deployed URL.
Outbox manifest per Rule 67: commit hash, deploy status, both TASK 4
outputs verbatim, explicit confirmation jubilant-bassoon's rejection
still fires correctly post-deploy.

---

## Done Condition

`field-playground` accepts a write at any path via `commit_file` on the
LIVE deployed URL. `jubilant-bassoon` (and by extension field-relay-nba)
still reject a non-allowlisted path with the same error as before —
confirmed by an actual failed call, not by code inspection alone.

**Confidence scoring:**
+25 `isPathAllowed` correctly extended (T1) — traversal/absolute-path
    checks still run unconditionally for every repo
+25 Both call sites correctly made repo-aware (T2), using the real
    resolved `repo` variable at each site
+15 Both tool descriptions updated (T3)
+25 Real verification (T4): field-playground write succeeds AND
    jubilant-bassoon rejection still fires, both against the LIVE
    deployed endpoint — this is the one that actually proves nothing
    leaked into production
+10 Clean commit, honest outbox manifest

Automate follow-ups. No fallbacks, only fixes — if `repo` turns out not
to be cleanly available at one of the two call sites the way TASK 2
assumes, trace back to where it's actually resolved rather than adding a
second, parallel repo-detection path.

Do not commit unless confidence >= 95. If score < 95, report verbatim and
stop.

---

## ONE-LINER

git pull. Read docs/CC-CMD-2026-07-23-playground-write-allowlist.md --
make field-playground's commit_file/commit_file_patch writes unrestricted
(isPathAllowed accepts a null allowlist meaning "any path", traversal
checks still apply) while leaving jubilant-bassoon and field-relay-nba's
WRITE_ALLOWLIST exactly as tight as it already is. Verify with a real
write to field-playground AND a real rejected write to jubilant-bassoon,
both against the LIVE deployed endpoint -- confirm nothing leaked into
production. Automate follow-ups. No fallbacks, only fixes.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
