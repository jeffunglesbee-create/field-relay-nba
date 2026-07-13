# Follow-up fix: /journalism/generate Analytics Engine 2-index bug — 2026-07-13

Same-session, self-completing follow-up per the user's explicit instruction
("Automate follow-ups. No Fallbacks, only fixes.") issued alongside the
Cluster 5 CC-CMD dispatch — not a residual note for a future session.

## What was found

Cluster 5's `[ANALYTICS]` telemetry (`0b6a773`, line ~11895) instrumented
an empty catch that turned out to wrap a real, already-known bug class: the
`/journalism/generate` live-path `writeDataPoint()` call passed
`indexes: [briefType, sport || 'none']` — Analytics Engine only accepts
exactly 1 index per write, so this call has silently failed on every
invocation since it shipped. The identical bug was already found and fixed
on the cron-slate side earlier this session
(`CC-CMD-2026-07-13-analytics-index-fix`, commit `67d798d`), whose own
outbox explicitly flagged this exact live-path call site as an
out-of-scope residual "for a future CC-CMD." That future CC-CMD is this one.

## The fix

`src/index.js` line ~11895, commit `c05581d`. Mirrors the cron-slate fix's
shape exactly:
```js
// before
indexes: [briefType, sport || 'none'],
blobs:   [result.layers_fired.join(',') || 'none'],

// after
indexes: [briefType],
blobs:   [result.layers_fired.join(',') || 'none', sport || 'none'],
```
`sport` moved into `blobs` rather than dropped — real dimension, just not
index-eligible. `briefType` kept as the sole index (the more useful
group-by dimension of the two: `generic`/`game_recap`/etc. vs. a sport
name already present in most call context).

## Dependency check before shipping (Rule 60/71/39)

Grepped for every consumer of `JQ_ANALYTICS` in-repo: only 2 write call
sites exist (`writeDataPoint` at line ~6804, the already-fixed cron-slate
path, and this one). Zero in-repo reads — Analytics Engine data is queried
externally via Cloudflare's Analytics Engine SQL API, not from within this
Worker. This confirms the change is self-contained: single call site,
single caller, no downstream in-repo contract to update.

## Live verification

Deployed (`c05581d` → deploy run success, confirmed via
`get_deploy_status`, not the flaky Actions-status field). Real minimal POST
to `/journalism/generate` (`briefType: "diagnostic-verify"`,
`max_tokens: 200`) fired via a temporary GitHub Actions workflow tailing
the live worker.

**First attempt** used `--search "ANALYTICS"` and came back with a 0-line
capture — genuinely ambiguous (could mean "no error, fix worked" OR "tail
didn't connect in time," unlike a forced-failure test where the response
body gives independent proof). Investigated rather than assumed either
way: re-ran with **no search filter**, to force a non-empty capture
regardless of outcome.

**Second attempt — conclusive**: captured exactly one real event, matching
the diagnostic call's own `cf-ray` and URL:
```json
{
  "outcome": "ok",
  "logs": [],
  "exceptions": [],
  "event": { "request": { "url": ".../journalism/generate", "method": "POST" } }
}
```
`logs: []` and `exceptions: []` on a real, confirmed-live-captured
invocation is direct, positive proof the `[ANALYTICS]` `console.error` did
NOT fire — the fix works. The request itself also succeeded normally
end-to-end (`score: 180`, real generated prose, `retries: 1`,
`layers_fired: ["2d"]`), confirming zero regression to the success path.

## Cleanup

Temporary workflow (`temp-analytics-fix-verify.yml`) and both attempts'
diagnostic capture files removed. `node --check src/index.js` clean.
`git diff c05581d -- src/index.js` shows zero drift since the real fix
commit — nothing else touched.

## Commits (all on `main`)

- `c05581d` — the real fix
- `3dc2ee7`/`e6df390` — temporary verify workflow (added, then broadened
  from filtered to unfiltered tail capture to resolve a genuine ambiguity
  rather than accept an inconclusive first result)
- `c6ab51b`/`d3cca25` — temp diagnostic captures (first attempt:
  inconclusive 0-line filtered capture; second attempt: conclusive
  unfiltered capture proving zero logs/exceptions on the real request)
- (this commit) — all temp files removed, this outbox written

## Status: SHIPPED, live-verified, zero regression, zero residual
