# CC-CMD-2026-08-09-create-field-laboratory-repo

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-09-create-field-laboratory-repo.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## What's already confirmed, empirically, before this doc was written

- The default `secrets.GITHUB_TOKEN` genuinely cannot create a new repo —
  confirmed directly via a real CI call from field-playground:
  `POST /user/repos` → HTTP 403, `{"message":"Resource not accessible
  by integration"}`. This is documented, expected GitHub behavior
  (the automatic token is scoped only to the repo a workflow runs in),
  now proven rather than assumed.
- `field-relay-nba/.github/workflows/deploy.yml` already, genuinely
  uses a **different**, named secret — `RELAY_GH_PAT` — passed as
  `GITHUB_PAT` to the wrangler deploy step, and separately used
  directly (`env: RELAY_GH_PAT: ${{ secrets.RELAY_GH_PAT }}`) in the
  `verify` job's own rule-registry, completion-field, and soccer-
  league-label checks. It is real, active, and already proven to
  authenticate against `api.github.com` for read operations
  (`GET /repos/.../contents/...`) in this exact repo, today.
- "field-laboratory" has no prior history anywhere in past
  conversations or Drive — confirmed via direct search of both. This
  is a genuinely new repo, not a rename or a forgotten prior plan.
- `field-playground`'s own creation is fully documented in Drive
  ("FIELD — Playground Complete Record — Part 6 — Origins, Rubric,
  and Purpose," and `field-relay-nba/outbox/cc-session-2026-07-22-
  add-field-playground-repo.md"). This CC-CMD applies that exact,
  proven process — re-read both directly before executing, don't work
  from this doc's own summary of them.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Re-confirm `RELAY_GH_PAT` is still a real secret on this repo (the
  existing checks in `deploy.yml`'s `verify` job already depend on it
  — if those are currently passing in recent CI history, the secret
  is live; check real, recent run history rather than assume).
- Re-read `RELAY_GH_PAT`'s real, current scope is unknown from here —
  Task 2's first job is determining this empirically, not assuming it
  has `repo`-creation scope just because it authenticates for reads.

## Task 2 — Attempt real repo creation, empirically

Using `RELAY_GH_PAT` (not the default token, already proven
insufficient), make a real `POST https://api.github.com/user/repos`
call with `{"name":"field-laboratory","private":true,"auto_init":true}`
— `auto_init:true` requests a README at creation, matching the
reasoning `field-playground`'s own creation used (the first write into
a genuinely empty, zero-commit repo via the Contents API is a real
edge case worth not testing live).

- If this returns a real success (2xx) with a real repo URL: proceed
  to Task 3.
- If this returns 403/404 (insufficient scope): report the real,
  exact response. Do not retry with a different secret name guessed
  blindly — report back with what's confirmed and stop, since this
  becomes a real, human-in-the-loop question (does `RELAY_GH_PAT`'s
  own scope need to be widened, on GitHub's side, by Jeff directly).
- If this returns 422 (name already exists): stop and report — do not
  assume this means the repo is ready for use; a name collision could
  mean something else already occupies it.

## Task 3 — Apply field-playground's exact, proven creation process

If Task 2 succeeded, re-read `field-playground`'s real creation
reasoning (both Drive documents named above) and apply the same
decisions, not new ones:

- **Visibility: private.** Same reasoning as playground's own
  creation — a low-ceremony, fast-iteration space is exactly where a
  real credential gets pasted in for a quick test and forgotten; this
  project has a real, documented precedent for exactly that risk.
- **README initialized at creation** (already requested via
  `auto_init` in Task 2) — avoids the same first-write-to-empty-repo
  edge case playground's own creation explicitly reasoned about.
- **Governance model: match field-playground's real, current
  exemption exactly** — re-read its actual, current scope (not from
  memory) before writing anything into `field-laboratory` itself
  about what applies. State explicitly whether `field-laboratory`
  gets the identical exemption or a different one — this is a real
  decision, not automatic, even though the precedent points one way.

## Task 4 — Extend FIELD Handoff MCP tools (mirrors the 2026-07-22 work exactly)

Re-read `field-relay-nba/outbox/cc-session-2026-07-22-add-field-
playground-repo.md` directly for the real, exact mechanism used to
add `field-playground` as a valid `repo` value across `read_file`,
`read_source`, `read_lines`, `commit_file`, `get_archive_url`,
`trigger_workflow`, `get_deploy_status`. Apply the identical extension
for `field-laboratory` as a fourth valid value.

- That prior work found and fixed a real bug — a binary ternary at
  the routing layer that would silently route an unrecognized `repo`
  value to `field-relay-nba` instead of erroring. Re-verify this
  specific class of bug doesn't recur here — confirm a request for an
  invalid `repo` value still errors correctly, and a request for
  `field-laboratory` specifically reaches the new repo, not
  `field-relay-nba` by silent default.
- Verify with a real write AND a real read against the live deployed
  endpoint, not just code inspection — matching how the original
  extension was verified.

## Task 5 — Real verification

- A real, live `commit_file` call succeeds against `field-laboratory`
  through the extended MCP tools (not the raw GitHub API used in
  Task 2) — proving the full, intended path works end to end, not
  just the initial creation call.
- A real `get_archive_url` + fetch against `field-laboratory` returns
  the actual repo contents.

---

## Explicitly NOT in scope

- Do not decide what `field-laboratory` is *for* — that's Jeff's call,
  not something to invent or imply from the name alone.
- Do not build anything inside the new repo beyond what Task 3's
  initialization requires.
- Do not widen `RELAY_GH_PAT`'s own GitHub-side scope yourself if
  Task 2 finds it insufficient — that's a real, human action on
  GitHub's own settings, not something this CC-CMD can or should do.

---

## Outbox

`outbox/cc-session-2026-08-09-create-field-laboratory-repo.md`: the
real Task 2 result (success or the exact failure reason), the real
governance decision made in Task 3, and real, live confirmation the
extended MCP tools can read and write `field-laboratory` end to end.
