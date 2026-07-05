# CC-CMD: Deploy a real Cloudflare Container via GitHub Actions — no local machine, no CC-sandbox Docker dependency

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** New Container-enabled Worker config + one new GitHub Actions workflow. Zero changes to existing request-serving code paths.

**Why — real, confirmed context, not assumed:** CC's own sandbox is
Anthropic's ephemeral cloud container, not a local machine — confirmed
via prior session history, not this doc's invention. Whether that sandbox
can reliably perform a privileged `docker build && push` is unverified
and shouldn't be relied on. GitHub Actions runners are a real, already-
proven alternative: `deploy.yml` in this exact repo already authenticates
successfully via `secrets.CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
on every push. GitHub-hosted Ubuntu runners ship with Docker pre-installed
by default — standard, stable GitHub Actions behavior. This CC-CMD reuses
both facts rather than depending on CC's own sandbox for the build.

**Target time:** ~40 min

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail
- Do not assume Docker or privileged build works in your own sandbox —
  this CC-CMD deliberately does not require it. If any step below turns
  out to need something from your own sandbox rather than the GitHub
  Actions runner, stop and report that plainly rather than improvising
  a sandbox-side workaround.

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
grep -n "\[\[containers\|durable_objects\|migrations" wrangler.toml
grep -A2 "CLOUDFLARE_API_TOKEN" .github/workflows/deploy.yml | head -6
ls .github/workflows/ | grep -i container
```
Re-confirm no container config or conflicting workflow exists before
proceeding — this doc's snapshot (checked 2026-07-04) may have drifted.

## TASK 1 — Scaffold from Cloudflare's own template, isolated from this repo

**Revised approach — do not hand-author Container config in this repo's
`wrangler.toml`.** Hand-rolling `[[containers]]`/`[[durable_objects.
bindings]]`/`[[migrations]]` entries directly in the production relay's
config risks a subtle mistake (the DO/migrations linkage specifically)
affecting the live relay everything else depends on. Instead:

In the GitHub Actions job, run Cloudflare's own official scaffolding
command: `npm create cloudflare@latest -- --template=cloudflare/
templates/containers-template` into a **fresh, separate directory** —
not inside `field-relay-nba`'s existing structure. This generates a
complete, known-working Container project from Cloudflare's own
maintained template, with correct config already in place.

Deploy this as its own **separate, new Worker** (a distinct name, not
touching `field-relay-nba`'s existing Worker or wrangler.toml at all).
This is a proof that Containers work on this account at all — isolated,
zero risk to the production relay, zero hand-authored config to get
wrong. Once proven, integrating Containers into the relay for a real
workload is separate, follow-up scope — not part of this CC-CMD.

## TASK 2 — New GitHub Actions workflow

Write `.github/workflows/container-deploy.yml`, `workflow_dispatch`-
triggered, using `secrets.CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
the same way `deploy.yml` already does. The job: checkout, install
Wrangler, run `wrangler deploy`. Wrangler itself handles the Docker
build and push to Cloudflare's Container Image Registry internally —
do not hand-roll a separate `docker build`/`docker push` step unless
Wrangler's own deploy step genuinely fails to do this (check the real
output before assuming you need to work around it).

## TASK 3 — Trigger it, verify real deployment

Dispatch the workflow via the API (same `workflow_dispatch` pattern used
throughout this project). Confirm the run succeeds. Then verify the
Container is real via the Cloudflare dashboard path already confirmed
this session (`Workers & Pages` → `Containers`) shows a real deployed
application with the name used here, or via `wrangler containers list`
run from within the same GitHub Actions job as a verification step.
Report the actual container name/ID, not just "the workflow succeeded."

## SCOPE BOUNDARY

DO:
- Scaffold from Cloudflare's own official template, not hand-authored config
- Deploy as a separate, isolated Worker — zero changes to field-relay-nba's existing wrangler.toml or Worker
- Reuse existing secrets exactly as deploy.yml already does
- Verify real deployment, not just workflow success
- Report the actual container identifier

DO NOT:
- Attempt this from your own sandbox — GitHub Actions only
- Hand-author Container config in field-relay-nba's wrangler.toml — use
  Cloudflare's own scaffolding template in an isolated location instead
- Build anything beyond a minimal proof container in this CC-CMD — a
  real workload (e.g., the earlier-discussed backfill-via-Container or
  upset-model-via-Container ideas) is separate, follow-up scope
- Touch any existing request-serving Worker code or field-relay-nba's
  existing wrangler.toml at all

## DONE CONDITIONS
- [ ] Probe block re-run, no drift from this doc's snapshot
- [ ] Minimal Container config + Dockerfile added
- [ ] `container-deploy.yml` written, reuses existing secrets correctly
- [ ] Workflow dispatched and succeeds
- [ ] Real deployment verified (dashboard or `wrangler containers list`), actual identifier reported
- [ ] Outbox manifest written with real evidence

## COMPLIANCE
- Rule 68: probe block first
- Rule 87: self-completing — this is achievable entirely within GitHub Actions, no external dependency

## CONFIDENCE SCORING TABLE
+20  Minimal container config correct (migrations: new_sqlite_classes, matching DO binding)
+30  Workflow correctly reuses existing secrets, no sandbox-side Docker dependency introduced
+30  Real deployment confirmed via dashboard or wrangler containers list, not just workflow success
+20  Actual container identifier reported, not a vague success claim

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-container-github-actions-deploy.md.
In container-deploy.yml (workflow_dispatch, reusing the existing
CLOUDFLARE_API_TOKEN secret exactly like deploy.yml), scaffold a fresh
project from Cloudflare's own official template (npm create
cloudflare@latest -- --template=cloudflare/templates/containers-template)
in an isolated location — do not hand-author Container config in this
repo's wrangler.toml, and do not touch field-relay-nba's existing Worker
at all. Deploy it as a separate Worker, dispatch the workflow, and
verify real deployment via wrangler containers list or the dashboard —
report the actual container identifier, not just workflow success. Do
this entirely via GitHub Actions, not your own sandbox. Do not commit
unless confidence ≥ 95. If score < 95 report verbatim and stop.
