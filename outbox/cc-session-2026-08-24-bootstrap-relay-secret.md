# The credential is a compiled-in literal, and the bootstrap reads it from source

## Correcting yesterday's claim

I said `RELAY_SHARED_SECRET` was a Cloudflare binding with a hardcoded fallback —
`env.RELAY_SHARED_SECRET || '<literal>'` — and that dropping the fallback risked
401s if the binding differed. Both halves were wrong.

`env.RELAY_SHARED_SECRET` appears **once** in `src/index.js`, at ~9257, and it is
an **outbound** header on the `/debug/gemini-model-test` route calling the proxy.
Every inbound gate compares against a bare string literal:

```
 3963   && request?.headers.get('X-FIELD-Relay') === '<literal>'
13437   if (authHeader !== '<literal>')      /savant sync
13885   if (authHeader !== '<literal>')      /d1/execute
14675   if (authHeader !== '<literal>')
14699   if (authHeader !== '<literal>')
14719   if (authHeader !== '<literal>')
14748   if (authHeader !== '<literal>')
14774   if (authHeader !== '<literal>')
14954   if (... !== '<literal>')
15018   if (... !== '<literal>')
```

Nothing reads a binding for authentication. There is no binding to differ from.

What that changes:

- Adding a Cloudflare secret does nothing. The value is fixed at build time.
- Rotation means editing the literals and deploying. No 401 window if it lands in
  one commit — the worker flips atomically.
- The exposure is worse than described. It is not a default that a binding
  overrides; it is the credential, committed.

The name `RELAY_SHARED_SECRET` is mine, chosen yesterday for the Actions secret so
the Courier had something to carry. Nothing in this relay used that name before.

## What shipped

`.github/workflows/bootstrap-relay-secret.yml`, dispatch-only. OIDC in, Courier
`/secret` out, writing `RELAY_SHARED_SECRET` into **this** repository so
`deploy.yml`'s existing sync step has something to read and can forward it to
field-laboratory.

`ALLOWED_REPOS` in the Courier gates the *caller* (field-relay-nba); the target is
a body parameter, so writing back into the same repo is the same call shape as the
three `field-*` syncs already in `deploy.yml`.

### The value comes from source, not from a paste

`src/index.js` is the authority — the deployed worker compares against that
literal and nothing else, so a value typed anywhere else could disagree with what
actually authenticates. The workflow extracts it:

```bash
mapfile -t FOUND < <(grep -ao "X-FIELD-Relay') !== '[^']*'" src/index.js \
  | sed "s/.*!== '//; s/'$//" | sort -u)
[ "${#FOUND[@]}" -ne 1 ] && exit 1
echo "::add-mask::${FOUND[0]}"
```

**Exactly one distinct literal, or stop.** An extraction that silently picked one
of several would write a value some gates reject, and that failure would surface
as a 401 in another repo days later. Run against the real file: `1` distinct
literal, 21 characters. `::add-mask::` keeps it out of the log.

This also makes the workflow the rotation tool: change the literal, deploy,
dispatch this, and the secret follows.

## The guard gained a file, and a check on its own file list

`scripts/check-courier-sync-uses-secrets.mjs` scanned `deploy.yml` only. The new
workflow makes the same Courier POST and was invisible to it — the coverage gap
that lets the next literal land in the file nobody scans.

Now scans both, and asserts its own list is complete: every workflow under
`.github/workflows/` containing the Courier URL must appear in `WFS`. Without
that, adding a third Courier-calling workflow silently reintroduces the gap.

**Demonstrated failing** by removing the new workflow from `WFS`:

```
FAIL every workflow calling the Courier is scanned
     not in WFS: .github/workflows/bootstrap-relay-secret.yml — its Courier calls are unchecked
1 failed
```

Full run: 5 syncs parsed, 0 literals, RELAY_SHARED_SECRET sync present, 0
unscanned. Self-test 5/5.

## What this does not do

It does not reduce the value's exposure. Still committed in `src/index.js` (27
occurrences), `src/analytics-engine.js`, 5 workflows and 8 docs. Moving it into a
secret store gives field-laboratory a way to receive it without adding a 42nd
copy; it does not make it a secret.

Rotation remains a separate decision, and it is now cheaper than I described
yesterday: edit the literals, deploy, dispatch the bootstrap. No binding to
coordinate.

**Standing, unaddressed:** `FIELD — OIDC Authentication Pattern Permanent
Reference May 18 2026` (Drive `1GRvHk70ScS8AGmm1EfcZgROCPUmOBBK0`) contains the
Courier's own `GITHUB_PAT` in plaintext — a repo+workflow-scoped token that can
write secrets into all four repositories, and the credential this entire mechanism
depends on.

## Files

- `.github/workflows/bootstrap-relay-secret.yml` — new, dispatch-only
- `scripts/check-courier-sync-uses-secrets.mjs` — scans every Courier-calling
  workflow, and checks that its own list is complete
