# Claude Code Command — two unauthenticated GET routes spend billed odds credits

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (spend reachable by anyone)
**Confidence gate:** >= 95 before any commit
**Status:** DONE 2026-10-29 for the two routes it gates. Route A `/archive/odds-backfill`: `1d55722`, Deploy RELAY Worker
`40863046648`, proof `outbox/odds-backfill-gate-live-proof-20261029T1120Z.md`. Route B `/identity/mismatches`: `5c664f8`
(pushed as `89f047a`), Deploy RELAY Worker `40920118796`, proof `outbox/identity-mismatches-gate-live-proof-20261029T1730Z.md`.
`/odds/*` (`oddsProxyRoute`) is named below but is not a task of this document: the owner ruled 2026-10-29 to hold and size
its cap from measured demand (`docs/CC-CMD-2026-09-16-odds-spend-attribution.md`).
**Filed by:** the Task 3 premise test of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`
(workflow `wf_c984c219-a1f`, 2026-10-23), Rule 87.4.

---

## What was found (read from source; not exercised, because it would bill)

- `/archive/odds-backfill` (GET and POST) calls `runOddsBackfillForDate`,
  which calls `fetchSportOddsHistorical` at 30 credits per sport-date.
- `/identity/mismatches` (GET) calls `fetchSportOddsLive` for up to five
  sports.
- Neither route head checks `Authorization`; the `/admin/*` routes near them
  check `FIELD_MCP_SECRET`. A grep for `Authorization` and `FIELD_MCP_SECRET`
  between the two route heads found none.
- Both spend under the crons' own site labels, so the ledger cannot tell an
  anonymous caller from the cron, and an anonymous caller spends toward the
  shared 3,800. Attributing calls by caller is premise 5 of
  `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md` (one
  worker tail for both labels); splitting the labels is Task 3 of
  `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`. **Task 3 (built
  2026-10-28) capped the shared labels but did not split them; the owner approved the
  split the same day and it was built then.** Each route now spends under its OWN
  label: `/identity/mismatches` as `identityMismatches` (cap 150) and
  `/archive/odds-backfill` as `archiveOddsBackfill` (cap 300), and `/archive/game`'s
  closing fetch as `archiveGameClosing` (cap 900), so an anonymous caller can spend
  at most its route's own cap and can no longer starve `fetchSportOddsLive` or
  `fetchSportOddsHistorical`. Before the split a reviewer reached the live cap in 134
  requests to `/identity/mismatches` on a fetch with no edge cache; the real rate,
  with `cacheEverything` and refunds, was UNVERIFIED and still is. What the split does
  NOT do is close the exposure: the routes still answer anyone. Through the three
  capped routes that is up to 150 + 300 + 900 = 1,350 credits a day, and the isolation
  is per label only: the day's 3,800 and the month's 85,000 are still shared, so an
  anonymous caller who fills the day starves every cron at the day's limit.
  **A third unauthenticated spender, found by the 2026-10-28 review of that build
  (BUILD-ON-A: added here, not filed anew): the `/odds/*` proxy route.** It charges
  `oddsProxyRoute`, which has NO cap, to the same shared day ceiling; each distinct
  `markets=` / `regions=` query string is a distinct edge-cache key, so a caller can vary
  it. Capping it is a policy number and the owner's; nothing here caps it. The split is
  executed, not read, by `scripts/check-odds-label-split.mjs` (the real worker, three routes
  and the cron paths) and `scripts/mutate-odds-label-split.mjs`.
- Related, not covering these: `/archive/game` is
  `docs/CC-CMD-2026-10-14-archive-game-unauthenticated-write.md` (RULED,
  blocked on rotation). Its closing fetch spends `archiveGameClosing` since 2026-10-28
  (it spent `fetchSportOddsHistorical` before), and that label is shared with the relay's own
  legitimate callers (the cron and GameDO closing fetches for sports AmbientDO does not cover),
  so its cap of 900 isolates it from the other labels, not from them.

**Narrowed 2026-10-23 (BUILD-ON-A).** A content audit against every existing
CC-CMD (workflow `wf_dd67792d-4ca`) kept the two route gates and the caller
census, answered TASK 0.2 from an existing CC-CMD, dropped the "move under
`/admin/`" option (CLAUDE.md: "Do NOT remove or rename existing routes"), and
rewrote the done condition so it can fail.

## TASK 0 — answered 2026-10-23, re-run at dispatch

1. **Callers** (grep of all four repos' code and workflows, 2026-10-23):
   - `/identity/mismatches`: `.github/workflows/odds-identity-join-saturday.yml`
     (cron `40 23 * * 6`, through `scripts/probe-odds-join.mjs`), sends no
     credential; `.github/workflows/probe-odds-api.yml` (dispatch only).
   - `/archive/odds-backfill`: no caller in code or workflows.
   - Both: the MCP self-probe allow-list (`ALLOWED_EXACT` has
     `/archive/odds-backfill`; `ALLOWED_PREFIX` has `/identity`). It sends
     no credential.
   - None in jubilant-bassoon, field-laboratory or field-playground.
2. **A 30-day lookback does not exist.** No per-path request record is kept:
   `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md` TASK 0 found
   Workers analytics has no path dimension and no tail consumer is
   configured; `/debug/recent-requests` logs only the OAuth and MCP paths.
   Turning on Workers Logs is a `wrangler.toml` change reserved to the owner
   there. Forward attribution is the tail in premise 5 of the 10-21 CC-CMD.

## TASK 1

- **The secret is `FIELD_MCP_SECRET`** (`Authorization: Bearer`, as the
  `/admin/*` routes check it). Not `RELAY_SHARED_SECRET`: it is listed in
  `docs/exposed-secrets.sha256`, and the 10-14 ruling says gating with a
  published credential is worse than leaving the route open.
  `FIELD_MCP_SECRET` is not in that list.
- **Route A, `/archive/odds-backfill`:** gate it. No FIELD caller sends a
  request today, so nothing breaks.
- **Route B, `/identity/mismatches`:** the Saturday workflow would get 401
  and exit 1. That workflow belongs to B2 of
  `docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md`, whose
  B1 is an open owner decision ("If B1 chooses (b), remove the workflow
  instead"). Gate route B in the same commit as B2's outcome: either the
  workflow sends the secret, or it is removed. Not before.
- **The self-probe** sends no credential, so after the gate it gets 401.
  That 401 is the done-condition artifact; do not teach the self-probe the
  secret.
- A check that a request without the header gets 401 before any odds
  function runs (the spending function stubbed to throw), and a mutation that
  removes the check.

## Done condition (Rule 90 artifacts)

1. TASK 0 re-run at dispatch, with any caller not listed above.
2. The TASK 1 check red at the parent and green after; its mutation caught.
3. After deploy, the relay self-probe of each gated route returns HTTP 401
   (status code, not a body string). `by_site` for the route's label, read
   just before and just after the probe with no cron tick between, does not
   move.

## Results

### Route A, `/archive/odds-backfill`, 2026-10-29 (owner: "decisions approved")

1. **TASK 0 re-run at dispatch:** no workflow, script or other repo calls the route; the callers are the MCP self-probe
   allow-list (no credential) and two `curl` lines in an old CC-CMD. Nothing was added to the 10-23 list.
2. **TASK 1 check red before, green after, mutation caught:** `scripts/check-odds-label-split.mjs` 68 of 68 on the real
   worker (no credential, wrong credential, the published relay secret, unset and empty secrets: all 401, vendor stub
   never called, no counter or ledger row moved; the right secret: 200 and one charge under `archiveOddsBackfill`);
   `scripts/mutate-odds-label-split.mjs` 24 of 24, with L22 to L25 for the gate.
3. **After deploy: HTTP 401, `Unauthorized`,** from the self-probe of `/archive/odds-backfill?date=2026-10-28`. `by_site`
   for `archiveOddsBackfill` 0 before and 0 after, day used 449 before and after, month used 46323 before and after (table
   and its limits in the proof). The authorized path (200 with `FIELD_MCP_SECRET`) was not run live; the check runs it.

### Route B, `/identity/mismatches`, 2026-10-29 (owner: B1 "keep as much as possible, retire only if necessary")

B1 was decided as (a) (keep the route and the workflow), so the gate and the callers' secret ship together, as this
document required: the route (`5c664f8`), the probe script and the two workflows that call it (`3f5dabf`) were pushed as
one `89f047a`.
1. **TASK 0 re-run at dispatch:** the callers are `scripts/probe-odds-join.mjs`, run by `odds-identity-join-saturday.yml`
   (cron `40 23 * * 6`) and by `probe-odds-api.yml` (dispatch only); both now pass `FIELD_MCP_SECRET` from the repo secret,
   which other workflows already use against `FIELD_MCP_SECRET`-gated routes. The MCP self-probe allow-list (prefix
   `/identity`) sends no credential and now gets 401 on this route; `/identity/substitution-census`, which the ambiguity
   watch reads, is a different route and stays open. Nothing in jubilant-bassoon, field-laboratory or field-playground calls it.
2. **The check red before, green after, mutation caught:** `scripts/check-odds-label-split.mjs` 80 of 80 on the real worker
   (no credential, wrong credential, the published relay secret by `Authorization` and by `X-FIELD-Relay`, unset and empty
   secrets, the right secret with something before or after it: all 401 with the vendor never called and nothing moved; the
   right secret: 200 and a charge under `identityMismatches`); `scripts/mutate-odds-label-split.mjs` 27 of 27 (L26, L27, L28
   for the gate and its comparison); `scripts/check-identity-route-join.mjs` 41 of 41 and its mutants 32 of 32 (J32 removes
   the gate).
3. **After deploy: HTTP 401, `Unauthorized`,** from the self-probe of `/identity/mismatches?date=2026-10-29&sports=CFB`.
   `by_site` for `identityMismatches` 0 before and 0 after, day used 758, month used 46632 and every reconcile row identical
   across the 15 seconds. The authorized path and the new report were not run live (no secret; an off-schedule run would
   spend about 12 credits, which needs the owner's word); the 2026-10-31 scheduled run is the live proof, read by
   `trig_01Xrhu7D91b4WhnQKAcPYQS9` on 2026-11-01.

### `/odds/*`, `oddsProxyRoute`: neither gated nor capped

Anonymous and uncapped, and it shares the day's 3,800 and the month's 85,000. It is the PUBLIC proxy the client's users
trigger, so it cannot be gated behind a secret. Owner 2026-10-29: hold, and size the cap from measured demand; the
2026-10-30T12:00Z wake (`trig_019pHMT7Ym3XGHi3KVKQLDZx`) reads the first closed day of per-label spend, `oddsProxyRoute` 0
credits so far today. No number is invented here.
