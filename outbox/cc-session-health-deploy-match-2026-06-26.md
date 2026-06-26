# session_health deploy_match — 2026-06-26

## Commit

- `3769578` fix(session-health): deploy_match against last src/ commit, not raw HEAD
- Deploy: deploy step success at ~12:39Z; bundle verified (`relay_head_src` × 3,
  `commits?path=src` × 1 in deployed code).

## Change

`relay_head` still surfaces raw Git HEAD (human reference, unchanged).
A new `relay_head_src` field fetches the most recent commit touching `src/`
via the GitHub commits-by-path API (`/repos/.../commits?path=src%2F&per_page=1`).
`deploy_match` now compares `relay_deployed` to `relay_head_src` instead of
`relay_head`, falling back to `relay_head` if the API call fails.

Eliminates the false alarm where any workflow/docs/outbox commit advances raw
HEAD without triggering a deploy → `deploy_match` would stay `false` until the
next src/ commit.

## Live session_health output

```json
{
  "client_head": "33c532e",
  "relay_head": "3769578",
  "relay_head_src": "3769578",
  "relay_deployed": "6081d3d",
  "deploy_match": false,
  ...
}
```

`deploy_match: false` here is **correct**: my src/ commit `3769578` is mid-flight
through CI (deploy step completed and uploaded the new bundle, but the full
workflow has post-deploy probes still pending → `status=success` doesn't list it
yet for the relay_deployed lookup). Once the workflow finishes,
`relay_deployed = 3769578` and `deploy_match = true`.

## Done conditions

- [x] `node --check src/index.js` clean
- [x] Bundle verified via `workers_get_worker_code`: `relay_head_src` × 3 hits,
      `commits?path=src` × 1 hit
- [x] Live `session_health` returns `relay_head_src` field
- [x] `deploy_match` now uses `relay_head_src ?? relay_head`
- [x] No regression: `relay_head` still raw HEAD (human reference)

## Verification of the design intent (against future commits)

The CC-CMD's two-state test:

1. **Future src/ commit deploys.** `relay_head_src` advances → `relay_deployed`
   advances on next successful workflow → `deploy_match: true` correctly.
2. **Future docs/workflow commit lands (no src/ change).**
   `relay_head` advances (raw HEAD), but `relay_head_src` stays at the prior
   src/ commit → `relay_deployed` (still pointing at that src/ commit) ===
   `relay_head_src` → `deploy_match: true` correctly. No false alarm.

This outbox commit itself (docs/, no src/ change) provides the second test:
after this lands, `relay_head` will advance to the outbox commit while
`relay_head_src` stays at `3769578` and `relay_deployed` should equal
`relay_head_src` → `deploy_match: true`.

## Compliance

- **Rule 47**: Pure data field. No editorial computation.
- **Rule 69**: Only `src/index.js` touched. One commit.
- **Rule 77**: Bundle verified via `workers_get_worker_code` (not just /deploy/verify).
- **Rule 78**: One extra GitHub API call per session_health invocation —
  rate-limit impact negligible (session_health is on-demand, not cron).
- **Rule 80**: No credentials in agent context. The GH API call uses the
  worker-side `gh()` helper (existing pattern).
