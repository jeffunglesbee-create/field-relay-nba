# CC-CMD-2026-08-10-laboratory-secret-bootstrap — Result

## Status: DONE. Done condition met — the laboratory page is live, with no human having entered a credential. **Confidence: 96.**

Branch `main` throughout. Commit `10d5621` adds the step; the rest are probe
workflows.

## PROBE FIRST — all three confirmed at HEAD

| probe | result |
|---|---|
| `ALLOWED_REPOS` | contains `jeffunglesbee-create/field-relay-nba`; `OIDC_AUDIENCE = 'field-deploy'` |
| `/secret` body contract | `const {name,value,repo,owner}=body` — unchanged |
| existing BOOTSTRAP steps | `oidc` (769), `jubilant-bassoon` (777), `field-playground` (792) |

The CC-CMD's line reference for probe 2 had drifted — `sed -n '125,140p'`
lands inside the `/delete` handler now — so I located `/secret` by content
instead, as the CC-CMD instructs when line refs move. The contract itself is
exactly as described.

## The premise I did not take on trust

The CC-CMD states field-laboratory "already has a complete, verified
Cloudflare Worker deploy." That conflicted with something I knew first-hand:
I created that repo about two hours earlier, and it held `auto_init`'s README
plus one docs file. Rule 72 — an inherited claim that changes what I do gets
verified, even when it comes from a document written today.

Verified via CI (that repo is outside this session's GitHub scope, and
`add_repo` needs an approval a non-interactive session cannot obtain).
`outbox/inspect-field-laboratory-20260810T022407Z.json`:

- 45 paths including `wrangler.toml`, `.github/workflows/deploy.yml` and four
  more workflows, `src/*.fs`, `scripts/`, `STATUS.md`
- `docs/mcp-access-confirmed.md` — the file my own Task 5 verification wrote
  earlier today, still present, confirming this is the same repo
- **`secret_names: []`** — no Actions secrets at all

So another session built it out in the interim, the claim is true, and the
diagnosis is confirmed rather than assumed: the deploy was skipping for want
of exactly this one value.

## TASK — one step added

`.github/workflows/deploy.yml`, immediately after the field-playground
bootstrap. The field-playground step with one repo name changed, as specified.

Kept deliberately: it **fails** the step rather than warning, matching
field-playground and not jubilant-bassoon's warn-only shape. A silent failure
here recreates precisely the state this fixes.

No second OIDC step and no second job — `steps.oidc.outputs.token` is reused,
the job already declares `id-token: write`, and the Courier gates on the
*caller's* repository claim while the target is a body parameter. No Courier
change, which the CC-CMD rules out as resting on a false premise. No `set -x`
anywhere in the workflow.

One thing worth recording: the commit did **not** trigger a deploy. That
workflow's `on.push.paths` is `src/**`, `wrangler.toml`, `workers/**`, so a
`.github/workflows/` edit is correctly outside it. I checked the trigger
config rather than waiting on a run that was never going to start, then used
`workflow_dispatch` as the CC-CMD's VERIFY step 1 says.

## VERIFY 1 — the Courier response, verbatim

Run `31349824696`, step 37, conclusion **success**:

```
Result: {"ok":true,"message":"Secret CLOUDFLARE_API_TOKEN created in jeffunglesbee-create/field-laboratory"}
✅ CLOUDFLARE_API_TOKEN synced to field-laboratory
```

**"created"**, not "updated" — independently consistent with the inspection's
empty secret list. In the same log both `OIDC_TOKEN` and `CF_TOKEN` render as
`***`; no credential value reached the log, and none passed through chat.

## VERIFY 2 and 3 — the laboratory deploys and serves

`outbox/verify-field-laboratory-deploy-20260810T023603Z.json`:

```
dispatch    204
deploy_run  31350234172   completed / success
site        status 200, bytes 2414, contains_FIELD_Laboratory: TRUE
version_txt status 200, "81e35bdfabdae928d4b4339f706cc83120b28d50"
STATUS.md   Cloudflare Workers | live | 81e35bd
done_condition_met: TRUE
```

`STATUS.md` had already flipped to **live** on its own, as the CC-CMD
predicted. The commit it reports serving matches `/version.txt` exactly.

## The first verification run said the done condition was NOT met — and it was wrong

```
site: status 404, bytes 17, head "error code: 1042", contains_FIELD_Laboratory: false
```

...while, in the same run, `/version.txt` returned 200 and `STATUS.md` said
live. Rather than re-run until it passed, I diagnosed the contradiction
(`outbox/diagnose-laboratory-404-*.json`), which probed five paths with
**headers**, since a status code alone cannot separate an edge error from a
missing asset:

```
/                200  2424 bytes  text/html
/index.html      200  2424 bytes  text/html
/version.txt     200    41 bytes  text/plain
/STATUS.md       404  empty body
/nope-404-check  404  empty body
```

Cloudflare `1042` was a transient edge error during propagation. The empty-body
404s on genuinely missing paths are `not_found_handling = "none"` behaving
exactly as `wrangler.toml`'s own comment describes.

**The bug was in my probe: a fixed 10-second settle after deploy.** It turned a
propagation transient into a reported failure — the kind of noise that gets a
check distrusted and switched off. Fixed by polling up to 30×10s for *both* a
200 and the page text, and recording the attempt count so a genuinely slow
deploy stays visible instead of being hidden behind a longer sleep. The
corrected run needed `attempts: 1`.

Re-running the original until it went green would have "worked" and proven
nothing about the next run.

## Scope held

No Courier change. No new credential. No changes to field-laboratory itself —
the deploy that ran there is its own, triggered via the API, and every file in
that repo is as another session left it.

## Flagged, not acted on

The CC-CMD's closing section reports a **live GitHub PAT in plaintext** in the
Drive document *FIELD — Deploy Courier v3 Reference May 18 2026*
(`1HSpCVein07IRhjXCkyUx5EkLdtWoAERd`), documented as `repo`+`workflow` scope
and not expiring until May 2027 — meaning anyone with read access to that
folder has write access to these repositories. The Courier is on OIDC now, so
the PAT is no longer the mechanism, only exposure.

I did not verify this myself and did not act on it: rotating a credential is
Jeff's call. Repeating it here so it is not buried in a spec file. It is more
urgent than anything in this CC-CMD.

## Confidence gate

**96.** Every step produced a live artifact: the Courier's response quoted
verbatim from the job log, a real deploy run in the target repo, a 200 whose
*body* contains the page text (a bare 200 is explicitly not accepted, since an
assets Worker over an empty directory also returns one), `/version.txt`
matching `STATUS.md`'s self-reported commit, and the premise itself verified
against the repo's real tree rather than the document's claim.

Not higher because of the residual risk my own probe demonstrated: the site
was reported dead once, by me, on a timing artifact. The fix polls rather than
sleeps, and its passing run took a single attempt — which is good, but it also
means the retry path itself has not been exercised under a genuinely slow
deploy. It will be the first time one occurs; I have not proven it.

## Residual

None deferred. The only open item is the Drive PAT above, which is explicitly
a human action and is flagged, not carried.
