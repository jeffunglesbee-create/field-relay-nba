# CC-CMD 2026-10-12 — re-authorization without the shared secret

**Scope:** `field-relay-nba` — `src/mcp-oauth.js`.
**Prerequisite shipped:** the enrollment window (`CC-CMD-2026-10-12-mcp-enrollment-window.md`).
That is a recovery path, not this fix. This CC-CMD removes the need for it.

## The problem, stated precisely

`POST /oauth/authorize` gates on `FIELD_MCP_SECRET`. That value lives in a
GitHub Actions secret and a Cloudflare Worker secret, **neither of which can
display it**, by design — the Deploy Courier exists so no human ever handles it.

So when the FIELD connector's refresh token lapsed on 2026-10-12, the owner of a
single-user server had no way to re-authorize. Rotation is not a fix: a rotated
value is equally unreadable.

This recurs on the refresh-token clock. `TTL_REFRESH` is 7776000 (90 days).

## Read this before designing: the obvious approach is insecure

The natural reading of "per-client trust" is: record that `client_id` X was
authorized once, then skip the password when X returns.

**Do not build that.** `client_id` is not a secret. It travels in the
authorization URL, it is handed out by `POST /oauth/register` to any caller, and
the repo is public. A trust record keyed on `client_id` alone means anyone who
registers a client and quotes a known id is authorized. That is strictly worse
than the enrollment window, which at least closes by itself.

The DCR `client_secret` does not rescue it either: `/oauth/authorize` is a
browser redirect, and the browser does not hold the client secret. Any design
that assumes the authorize endpoint can see it is wrong about the flow.

The trust must bind to something the **browser** can prove and an attacker
cannot replay.

## Task 1 — probe, before any design (blocking)

The viable interim design is a trust cookie: on a successful authorization, set
an HttpOnly, Secure, SameSite=Lax cookie on the relay origin holding a random
token stored in KV; on re-authorization, a valid cookie stands in for the
password. This works only if the client browser persists cookies on that origin
across sessions.

**That is unknown and must be measured, not assumed.** The reconnect happens in
the Claude iOS app's in-app browser on an iPad. In-app browsers vary in whether
they keep an ephemeral cookie jar.

Build a probe route that sets a cookie and reports whether a later request
carries it back. Have the owner open it, close the app fully, reopen, and open it
again. Record the result in the codex with the date and the app version.

**Report the finding before building anything.** If cookies do not persist,
Task 2 is dead and Task 3 is the only path — say so rather than shipping a
cookie mechanism that silently never fires.

## Task 2 — trust cookie (only if Task 1 says cookies persist)

- On a successful authorization by password **or** by enrollment window, mint
  `trust:{rand(32)}` in `MCP_OAUTH` and set it as an HttpOnly, Secure,
  SameSite=Lax, `Path=/oauth` cookie.
- `authorizePost` accepts a valid trust cookie in place of the password.
  Rotate the token on each use.
- `authorizeGet` must say which state it is in — the same requirement the
  password page just had to be fixed for. A recognized browser should read
  "this device is recognized", not an unexplained password box.
- Give the trust record a TTL and a server-side revoke, and make revocation
  reachable without the shared secret, or this reproduces the lockout one level
  up.

## Task 3 — WebAuthn platform authenticator

The end state. A passkey on the iPad: Face ID, no shared secret, nothing to
read, nothing to type, nothing to lose. It survives app reinstalls and cookie
clearing, which is exactly where Task 2 is weakest.

Workers can verify ES256 attestation and assertions with WebCrypto. Register
during an enrollment window — that is what the window is for.

## Acceptance criteria

Each state proven against the live endpoint, not by reasoning — same client,
same inputs, one variable changed:

1. No trust, window closed, wrong password → `401`.
2. No trust, window closed, correct password → `302` with a code.
3. Valid trust, window closed, **no password at all** → `302` with a code.
4. Trust revoked, window closed, no password → `401`.
5. Trust presented to a different `client_id` than it was issued for → `401`.

Criterion 5 is the one that catches the insecure design. If it passes with the
trust bound only to a cookie and not to the client, say so plainly in the
findings rather than recording a pass.

## Constraints

- Rule 80: no credential value in any committed file, log, or document.
- Never `set -x` in a workflow touching this path. That leaked
  `FIELD_MCP_SECRET` on 2026-07-13.
- Do not weaken PKCE, `redirect_uri` checking, or `validateBearer`.
- Leave the enrollment window in place. It is the recovery path for the
  deployment of this change going wrong.
