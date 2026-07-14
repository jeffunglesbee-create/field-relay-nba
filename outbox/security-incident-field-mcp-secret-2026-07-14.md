# Security incident: FIELD_MCP_SECRET leaked twice, rotated, root-caused, history scrubbed — 2026-07-13/14

Full handoff record for this incident. Supersedes the "Security Incident"
section of `outbox/rule89-scoped-tools-2026-07-13.md`, which was written
mid-incident and is now stale (it says rotation/scrub are "NOT
remediated" — both are now done; see status below).

## Timeline

**2026-06-02** — `debug-log-probe.yml` captured `/debug/recent-requests`
output and committed it to `outbox/debug-log-20260602T160117Z.json`. That
capture contained two live credentials in plaintext, logged by the
relay's own OAuth/MCP request logger: `FIELD_MCP_SECRET`
(`x-field-mcp-secret` header) and a short-lived OAuth access token
(`authorization: Bearer ...`, 1h TTL, already expired by the time this
was found). Not noticed at the time.

**2026-07-13** — While building live verification for
`CC-CMD-2026-07-13-rule89-scoped-tools` (a session task adding an `event`
field to `get_ci_status`/`get_deploy_status` and a new `commit_file_patch`
MCP tool — both unrelated to this incident and already shipped correctly),
a temporary verify workflow used `set -x`, which echoed the live
`FIELD_MCP_SECRET` value into a committed output file — the same secret
value as the June 2 leak, confirming it had never been rotated in the
6+ weeks between the two incidents.

**2026-07-14** — User instructed rotation. Sequence:
1. User rotated the GitHub Actions repo secret value (manual step, outside
   this session's access).
2. Dispatched `sync-secret-to-worker.yml` (run `29344798395`) to push the
   new value to the Cloudflare Worker.
3. Verified live: old leaked value → `401` (dead); new value → `200`,
   28 tools listed. Confirmed via a temp workflow that never printed
   either value (status codes only).
4. **Root cause found and fixed** (commit `ebe1c71`, was `7f1652c` before
   history rewrite): the request logger backing `/.well-known/*`,
   `/oauth/*`, `/mcp`, `/debug/recent-requests` (writes to `MCP_OAUTH` KV,
   1h TTL) filtered `cookie`/`x-real-ip`/`cf-*` headers but never
   `authorization` or `x-field-mcp-secret`, and logged the full query
   string unfiltered (the `/mcp` auth gate also accepts `?token=`). This
   is the actual mechanism behind both leaks — rotating the secret alone
   would not have stopped it from happening a third time. Now redacts all
   four credential channels at the logging site itself.
5. User instructed a full history scrub ("Scrub"). Investigated scope
   before executing (a plain search for the July 13 leak would have missed
   the June 2 one): `git log -S <value>` across all refs found the second,
   older leak and its second, different credential (the OAuth token). Used
   `git-filter-repo --replace-text` to strip both values from all 1400
   commits on `main`, force-pushed, and independently re-verified via a
   fresh clone — 0 occurrences of either value anywhere in `main`'s
   history.

## Current status

| Item | Status |
|---|---|
| `FIELD_MCP_SECRET` rotated | ✅ Done, confirmed live (old value 401s, new value works) |
| Root cause (logger redaction) | ✅ Fixed, shipped, deployed |
| `main` history scrubbed | ✅ Done, independently re-verified (0 occurrences) |
| OAuth access token from the June 2 leak | Not rotated — unnecessary, it's a normal 1h-TTL access token and expired over 6 weeks ago on its own |
| Stray branch `claude/zealous-brahmagupta-tm92w3` | ⚠️ **Still contains the old, unscrubbed history** (both leaked values). Confirmed to have zero commits beyond what `main` already has — fully redundant. `git push --delete` returned a 403 (proxy-level restriction) and no MCP tool for branch deletion was available this session. **Not a live risk** (both values it exposes are already dead), but the value is still visible there. Needs a human with full repo settings access to delete it via GitHub's UI — takes seconds. |

## Files/commits involved

- `outbox/debug-log-20260602T160117Z.json` — the original June 2 capture.
  No longer exists in `main`'s history (removed by the scrub); if you're
  looking at an old local clone or the stray branch, this is where the
  second leak lived.
- `ebe1c71` (was `7f1652c`) — the root-cause fix, `src/index.js` request
  logger.
- `outbox/rule89-scoped-tools-2026-07-13.md` — the original CC-CMD's
  outbox; still accurate for TASK 1/TASK 2 (the actual feature work,
  100/100, unaffected by any of this), stale for its own "Security
  Incident" section (written mid-incident, before rotation/root-cause/
  scrub were done).
- This doc — the current, authoritative record.

## What would need to happen for this to recur

It shouldn't, structurally: the logger no longer writes any of the four
credential channels in plaintext. If a fifth credential-bearing channel
is ever added to the `/mcp` auth gate (or the debug-log route set is
expanded to a path with its own credential scheme), the same redaction
pattern (`src/index.js`, the `_redactedHeaders`/`_redactedQuery` block
right after the OAuth surface comment) needs to be extended to cover it —
the filter is allowlist-adjacent but not fully allowlist-based, so this is
a real, standing thing to check when touching that auth gate again.
