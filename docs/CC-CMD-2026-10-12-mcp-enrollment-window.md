# CC-CMD 2026-10-12 — MCP enrollment window

**Status:** shipped and verified live. `src/mcp-oauth.js`, commit `1be6737`;
workflow fixes `14503e7`, `947dbcf`.

**Authored by chat, with an explicit one-time exception** to the standing rule
that chat never edits, commits or deploys code. The exception was asked for and
granted because the lockout below could not be cleared from outside the repo.

## The defect this fixes

`FIELD_MCP_SECRET` is the only human-typed credential in this system. It lives in
a GitHub Actions secret and a Cloudflare Worker secret. **Neither store can
display it back.** Its correct provisioning path — the Deploy Courier, then
`sync-secret-to-worker.yml` — was built precisely so that no human ever handles
it, and it worked: the value was installed without anyone reading it.

On 2026-10-12 the FIELD connector's OAuth refresh token lapsed. Re-authorizing
presents the shared-password page, which compares against `FIELD_MCP_SECRET`.
The owner of a single-user server was therefore locked out of it with no recovery
path, and **rotation does not help** — a rotated value is equally unreadable, and
`bootstrap-relay-secret.yml` reinstalls from source besides.

The defect is in the login, not the password. A credential that nothing can read
must not be the only gate on re-authorization.

## The mechanism

`MCP_ENROLL_UNTIL` is a Worker var holding an ISO-8601 instant. While it is in
the future, `POST /oauth/authorize` accepts the authorization without the
password and `console.warn`s the bypass with the `client_id` and the expiry.

`enrollmentState(env, now)` returns **four** values, not two:

| value | condition | opens? |
|---|---|---|
| `unset` | var absent | no |
| `unparseable` | `Date.parse` → `NaN` | no |
| `expired` | instant in the past | no |
| `open` | instant in the future | yes |

Rule 99. An unparseable value must not read as open: a typo would otherwise hold
the door permanently. `unset` is the steady state.

**The window is the whole control.** It closes by the clock whether or not
anyone comes back. There is no revoke step for anyone to forget, which is the
property that makes this safer than a standing recovery credential.

A timestamp is not a credential, so it is safe to log, safe to print in CI
output, and safe to hold in a Worker var.

## Verification — live endpoint, not reasoning

One throwaway DCR client, one deliberately wrong password, the only variable
being `MCP_ENROLL_UNTIL`:

| state | result |
|---|---|
| unset | `401`, body `Incorrect password`, no `Location` header |
| future | `302`, `Location` carries `code=` |
| past | `401`, body `Incorrect password`, no `Location` header |

The expired case was tested after a real 2-minute window ran out on its own, so
self-closure is observed, not inferred.

Also verified: `/mcp` rejects no-header and garbage-bearer with `401`, so the
`302` above is a real state change and not an unauthenticated endpoint. Token
revocation deletes the exact KV key `validateBearer` reads — `200` before
revoke, `401` immediately after, still `401` after 75 s.

## Two defects I introduced and fixed

Both were in the workflow's own assertions, both marked a run red **after the
write had already succeeded**:

1. Cloudflare answers **201** on creating the var; the check accepted only 200.
2. Cloudflare **pretty-prints**, so the flag arrives as `"success": true` with a
   space; the check grepped for `"success":true`.

Same mistake twice: asserting against a response's shape rather than its
content. The second fix parses with `json.load` instead.

A red run on a successful write is the dangerous direction. Whoever opens the
next window would read the red X and conclude it had not opened, while the relay
was in fact accepting unauthenticated authorizations.

## Operating it

`.github/workflows/open-enrollment-window.yml`, dispatch only:

- `minutes` — how long to stay open. Capped at **60**; the workflow refuses more.
- `minutes: 0` — closes it now (sets the epoch).

It generates the timestamp itself and re-validates it against a strict pattern
before interpolating, so no quote or backslash can reach the request body —
unlike `sync-secret-to-worker.yml`, which interpolates an arbitrary secret value
into JSON inside a double-quoted shell string and would break on `"`, `\`, `` ` ``
or `$`. That remains an open defect in that workflow.

**It does not use `set -x`.** That is how `FIELD_MCP_SECRET` leaked on
2026-07-13. Do not add it.

## The honest tradeoff

While the window is open, **anyone who completes DCR against the endpoint is
authorized.** The repo is public and the URL is discoverable. I demonstrated this
from a sandbox in seconds. Keep windows short, open them only when someone is
at the connector screen, and close with `minutes: 0` the moment the reconnect
lands rather than letting the clock run out.

## Open items

- `minutes: 0` close path is implemented and capped but **not yet exercised**.
- `unparseable` is proven by `Date.parse` semantics, not by a live probe.
- During the first revoke test a revoked token answered `200` once; a clean
  retest answered `401` immediately. **Cause unknown.** KV read-after-delete
  consistency is the candidate — that sequence fired two deletes against the
  namespace back to back — but it is not proven and is recorded here rather than
  filed as a defect.
- The throwaway probe client (`client_name: FIELD enrollment-window
  verification probe`) stays in KV until its 90-day TTL. There is no DCR delete
  endpoint, and the available KV tools are namespace-level, not key-level. A
  `client_id` alone authorizes nothing and anyone can register a fresh client
  during a window, so it adds no surface — but it is not zero and is logged.
- The real fix remains **removing the shared-password page's monopoly on
  re-authorization.** This window is a recovery path, not that fix.
