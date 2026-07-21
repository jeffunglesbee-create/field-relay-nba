# CC-CMD — Precisely diagnose the workflow_dispatch 422 root cause via relay-based API calls

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — correcting the framing before building anything

`workflow_dispatch` returning 422 is NOT a sandbox-egress problem — the
request genuinely reaches GitHub's API (confirmed: real 422 responses, not
connection failures), and GitHub itself rejects it. This was independently
confirmed on a brand-new workflow file created same-day with
`workflow_dispatch:` as its sole trigger, via two separate tools
(`trigger_workflow` and `actions_run_trigger`). The block is repo/account
level, not fixable via a code change or by routing around sandbox egress.

**What this CC-CMD actually does:** uses the relay's own GitHub PAT (already
present as a Worker secret, unrestricted egress by nature) to make direct,
read-only diagnostic API calls that pin down the EXACT cause — not to
attempt a workaround, since the investigation already established there
isn't a code-level one.

---

## TASK 1 — Check repo-level Actions permissions

```
GET https://api.github.com/repos/jeffunglesbee-create/field-relay-nba/actions/permissions
```
Using the relay's existing PAT (same one already used for D1/GitHub calls
elsewhere in this repo — reuse the existing auth pattern, don't add a new
credential). Report the real, actual `enabled` and `allowed_actions`
values verbatim.

## TASK 2 — Check the PAT's own token scopes

```
GET https://api.github.com/user
```
Read the `X-OAuth-Scopes` response header directly (not the body) — this
is the real, authoritative list of what the current token can do. Report
verbatim whether `workflow` scope is present. A classic PAT without
`workflow` scope cannot dispatch workflow runs even when the workflow file
itself is correctly configured — this is a real, common, and easy-to-miss
cause of exactly this 422 shape.

## TASK 3 — Direct comparison against a known-working dispatch

`deploy.yml`'s own `workflow_dispatch` has been successfully triggered
multiple times tonight via the same general mechanism. Compare its real,
actual trigger configuration against `post-deploy-live-verify.yml`'s — not
assuming they're identical just because both declare `workflow_dispatch:`.

```bash
git show HEAD:.github/workflows/deploy.yml | grep -A3 "^on:"
```

## TASK 4 — Honest, precise report

State the real, specific, confirmed cause — not "repo/account-level" as a
category, but the actual setting or scope gap. If Task 1 or 2 reveals it,
say so plainly and name the exact fix Jeff needs to make (which setting,
in which GitHub UI page, or which token to regenerate with which scope).
If neither reveals a clear cause, report that honestly too — don't force
a conclusion the data doesn't support.

---

## DONE CONDITION

The real, specific, confirmed root cause of the 422 is identified (not
just "repo/account-level" as a category) — via direct API inspection, not
further inference — with an exact, actionable fix named for Jeff if one
exists.

**Confidence scoring:**
- TASK 1 (25 pts): real permissions data retrieved and reported verbatim
- TASK 2 (35 pts): real token scope data retrieved and reported verbatim — this is the most likely real cause
- TASK 3 (15 pts): real, direct comparison against the known-working workflow
- TASK 4 (25 pts): honest, precise, actionable conclusion

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
This CC-CMD makes read-only diagnostic calls only — no workflow or
permission changes are authorized by this doc.
