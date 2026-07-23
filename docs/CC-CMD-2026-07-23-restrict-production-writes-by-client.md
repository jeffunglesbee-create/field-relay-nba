# CC-CMD: Restrict production writes to the known Claude OAuth client

**Date:** 2026-07-23
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** OAuth client tracking (`MCP_OAUTH` KV) + the write-tool handlers
(`commit_file`, `commit_file_patch`, `write_handoff`, `trigger_workflow`).

**Why — a real, reasoned gap, not a hypothetical.** Jeff is evaluating
connecting ChatGPT directly to this same MCP server (confirmed
technically compatible: OAuth 2.1 + PKCE + DCR at `/oauth/register`, all
verified live). ChatGPT's own write-confirmation dialog is a real,
OpenAI-documented mitigant, but it's a per-click, human-attention-
dependent gate — it confirms a payload looks reasonable, not that it
follows FIELD's conventions (CC-CMD dispatch for code changes, HANDOFF
format, Codex logging discipline). `WRITE_ALLOWLIST` already blocks any
client from writing outside `docs/`, `HANDOFF.md`, `CODE_MAP.json` for
jubilant-bassoon/field-relay-nba — but within that allowlist, and via
`write_handoff`/`trigger_workflow`, a second, uncoordinated client
currently has exactly the same raw capability the existing (Claude)
client does. This CC-CMD closes that gap structurally — enforced by the
server regardless of which client asks, not dependent on any client's
own behavior or good faith.

**Design principle:** any OAuth client registered via the public DCR
endpoint (`/oauth/register`) FROM THIS POINT FORWARD is untrusted by
default for production writes — restricted to `repo=field-playground`
only on every write-capable tool, full stop, regardless of path.
Whatever client(s) are ALREADY registered as of this fix's deploy are
grandfathered as trusted (this is the existing Claude connection — do
not attempt to reverse-engineer which specific client_id that is; snapshot
whatever's already there at fix time instead, which is more robust than
identifying it by inspection). This means: connecting ChatGPT AFTER this
ships, via DCR (the path OpenAI's own docs confirm ChatGPT uses),
automatically lands it in the restricted tier — no separate manual step
required at connection time.

**Real, honest scope acknowledgment:** chat traced the registration
endpoint (`src/index.js:8143`, `oauthRegister(request, env)`, backed by
the `MCP_OAUTH` KV namespace) but did not trace the full client data
model (`oauthRegister`/`oauthToken`/`oauthAuthorizeGet/Post` internals —
likely defined elsewhere in the same file or a separate module chat
didn't locate). The Pre-Build Probe below is not optional scaffolding —
it's the actual first real task.

**Target time:** ~40 min — this is genuinely more involved than most
CC-CMDs this project has shipped; do not compress the probe to save time.

---

## Do NOT Touch

- `WRITE_ALLOWLIST` / `isPathAllowed` / the field-playground exception
  shipped 2026-07-23 (`CC-CMD-2026-07-23-playground-write-allowlist.md`)
  — this CC-CMD adds a SECOND, independent layer (per-client trust) on
  top of the existing path-based layer. Both apply; neither replaces the
  other. A restricted client writing to field-playground still only gets
  what `isPathAllowed` already allows there (currently: anything, by
  design). A restricted client writing to jubilant-bassoon/field-relay-nba
  gets rejected by THIS fix before path-checking even matters.
- Read tools (`read_file`, `read_source`, `read_lines`, `get_ci_status`,
  `get_smoke_count`, `get_deploy_status`, `get_archive_url`,
  `get_head_sha`, `codex_search`, `codex_list`, `codex_read`,
  `session_health`) — this CC-CMD is write-tools-only. A restricted
  client should still be able to READ jubilant-bassoon/field-relay-nba
  freely; that was never the risk being closed here.
- Anything in `ambient-do.js`, `analytics-engine.js`, or other unrelated
  modules.

---

## Pre-Build Probe (run FIRST — this IS the work, not preamble)

```bash
git log --oneline -5
sed -n '8100,8145p' src/index.js
grep -n "function oauthRegister\|function oauthToken\|function oauthAuthorizeGet\|function oauthAuthorizePost" src/index.js
grep -rn "function oauthRegister\|function oauthToken" src/
grep -n "MCP_OAUTH" wrangler.jsonc wrangler.toml 2>/dev/null
```
Answer these before writing any fix code:

1. What does a registered-client record in `MCP_OAUTH` KV actually
   contain? (client_id, registration timestamp, redirect_uris, anything
   else?) Is there a natural field to key a "trusted" flag off, or does
   one need to be added?
2. At the point a `tools/call` request is handled (where `commit_file`
   etc. are dispatched), is the authenticated client_id already
   available in scope, or does it need to be threaded through from the
   token-verification step? Trace the actual request path from the
   Bearer token to wherever tool dispatch happens.
3. How many clients are CURRENTLY registered in `MCP_OAUTH` as of this
   probe? List them (client_id + registration time is enough, no need
   to print full records if they contain anything sensitive). This is
   the exact set that gets grandfathered as trusted — get it right,
   since anything missed here loses write access it currently has, and
   anything wrongly included stays over-privileged.

Report all three answers in the outbox manifest even if TASK 1 below ends
up looking different from what's drafted — this doc's job is to specify
the real fix, not to be followed blindly if the real client data model
doesn't match what chat could see from outside.

## TASK 1 — Mark the current client set as trusted

Based on what the probe finds, either: (a) add a `trusted: true` field to
every currently-registered client's KV record, or (b) write a separate
`MCP_OAUTH` key (e.g. `trusted-clients-snapshot`) listing the current
client_id set as of this fix's deploy — whichever fits the real data
model better. Either way, this must be a real, verifiable snapshot taken
from the probe's actual findings, not assumed.

## TASK 2 — Default new registrations to untrusted

In `oauthRegister` (wherever it actually lives), any client registered
from this point forward gets no trusted flag / is absent from the
trusted set — i.e., untrusted-by-default requires no explicit code path,
just the absence of what TASK 1 set. Confirm this is genuinely true
given the real implementation rather than assuming it falls out for
free.

## TASK 3 — Enforce at the write-tool handlers

At each of `commit_file`, `commit_file_patch`, `write_handoff`, and
`trigger_workflow`'s handlers: if the authenticated client is untrusted
AND the target `repo` is not `field-playground`, reject with a clear
error (e.g. `{isError:true, text:'This client is not authorized to write
to production repos. Contact the FIELD owner to request trust, or target
repo:"field-playground" instead.'}`) before any write logic runs. Trusted
clients: unchanged behavior, identical to today.

## TASK 4 — Real behavioral verification (in-session, not deferred)

This needs an actual untrusted client to test against, not just code
review:
```bash
# Register a throwaway test client via the real public DCR endpoint,
# exactly the path ChatGPT would use:
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{"client_name":"cc-cmd-verification-test","redirect_uris":["https://example.com/callback"]}' \
  | python3 -m json.tool
```
Complete enough of the OAuth flow with that new client to get a real
bearer token (PKCE code_challenge, /oauth/authorize, /oauth/token — this
may need a scripted flow since there's no browser here; check whether
`/oauth/authorize` supports a non-interactive path for testing, or
document exactly what a real interactive flow would require if not).
With that token:
1. Attempt `commit_file` against `field-playground` — must succeed.
2. Attempt `commit_file` against `jubilant-bassoon` at a real
   WRITE_ALLOWLIST path (e.g. `docs/should-be-rejected-untrusted.md`) —
   must be rejected by THIS fix (not by WRITE_ALLOWLIST, since that path
   IS allowlisted — confirm the rejection reason is the new
   client-trust check, not a coincidentally-overlapping old one).
3. Confirm the EXISTING (trusted, grandfathered) client — this chat
   session's own connection — still succeeds at both.
Revoke/clean up the test client registration afterward if the API
supports it; note in the manifest either way.

## TASK 5 — Commit + outbox manifest

Outbox manifest per Rule 67: what a client record actually contains
(probe answer 1), the exact trusted-client snapshot taken (probe answer
3, client_ids), all three TASK 4 outcomes verbatim, and explicit
confirmation the existing chat session's own access is unaffected.

---

## Done Condition

A newly-DCR-registered test client can write to `field-playground` but
is rejected writing to `jubilant-bassoon` at an otherwise-valid
WRITE_ALLOWLIST path, confirmed live. The existing (trusted) client's
access to all three repos is unchanged, confirmed live in the same test
pass, not assumed from "the code only adds a new check."

**Confidence scoring:**
+20 Probe (questions 1-3) answered with real evidence from the actual
    client data model, not assumed
+15 Trusted-client snapshot correctly captures the exact current set —
    getting this wrong either breaks Claude's own access or leaves an
    unintended client trusted
+20 Untrusted-by-default correctly falls out of TASK 1+2 for future
    registrations
+20 All four write-tool handlers correctly enforce the check (T3)
+20 Real live verification (T4) — a genuine new client tested against
    both a permitted and a rejected write, plus confirmation the
    existing client is unaffected
+5  Clean commit, honest outbox manifest

Automate follow-ups. No fallbacks, only fixes — if the real client data
model doesn't cleanly support a "trusted" flag the way TASK 1 assumes,
do not bolt on a parallel tracking mechanism; find the real shape and
fix the actual data model.

Do not commit unless confidence >= 95. If score < 95, report verbatim and
stop.

---

## ONE-LINER

git pull. Read docs/CC-CMD-2026-07-23-restrict-production-writes-by-client.md
-- structurally close the ChatGPT-coordination gap rather than rely on
its own confirmation dialogs: snapshot the currently-registered OAuth
client(s) as trusted, make any client registered via /oauth/register from
now on untrusted by default, and reject commit_file/commit_file_patch/
write_handoff/trigger_workflow for untrusted clients unless repo is
field-playground. Verify with a real newly-DCR-registered test client --
confirm it can write to field-playground, gets rejected on jubilant-bassoon
at an otherwise-valid path, and confirm the existing trusted client's
access is unaffected. This is genuinely more involved than usual --
do not compress the probe. Automate follow-ups. No fallbacks, only fixes.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
