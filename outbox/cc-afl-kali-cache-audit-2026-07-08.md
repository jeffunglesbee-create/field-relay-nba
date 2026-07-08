# Independent Audit of the Out-of-Process AFL/Kali Caching Commit — 2026-07-08

## What This Is

This CC-CMD exists to independently re-verify commit `c19009f` (AFL Kali
caching), which the audit doc states was made directly via a chat session's
bash_tool/GitHub API, bypassing the normal CC-CMD process. Git metadata
confirms `c19009f`'s author is `jeffunglesbee-create <jeffunglesbee@gmail.com>`
— consistent with a direct GitHub-API commit path (which attributes commits
to the authenticated account) rather than this session's own convention of
explicit `git config user.email "claude@field.dev"` before a local commit.
Noted for accuracy, not disputed — the underlying claim (this bypassed the
established probe/live-test/outbox process) holds regardless of exactly
which tool made the API call.

## TASK 1 — Composition Verified, No Repair Needed

Probe block run against current HEAD confirmed all three layered fixes
present, in order, and non-conflicting:

```
git log --oneline -8   → c19009f, 377b74d, f9c379c all present, correct order
cacheTtl: 3600          → present (line 470)
rawProb / 100           → present (line 486, scale-normalization fix intact)
rangeStart/rangeEnd     → present (lines 389-390, date-range fix intact)
node --check            → clean
```

Full branch re-read end-to-end: the caching directive sits inside the Kali
fetch options, the scale fix operates on the fetch's result, the date-range
fix lives inside `_discoverAFLRound` (called before any of this). No
collision, no accidental reversion. **Nothing needed fixing.**

## TASK 2 — Live E2E Re-Verification, Fresh Fixture

Per the doc's explicit instruction not to reuse the Fremantle/Sydney
example if stale, re-probed the current AFL scoreboard and used a genuinely
different, previously-untested matchup: **Collingwood v North Melbourne,
round 18**.

```javascript
pick_made:     { gameId: "g100", sport: "Australian Football (AFL)", predictedWinner: "Collingwood" }
pick_resolved: { gameId: "g100", wasCorrect: true }
→ { resolvedProbability: 0.889, probabilitySource: "kali", probabilityLabel: "Statistical probability" }
```

`0.889` is a plausible 0-1 value — the specific scale sanity check the doc
required (guarding against a repeat of the earlier `57.9`-not-`0.579`
mistake) passes.

## TASK 3 — Cache-Hit Behavior: Tested, and Found NOT Working

This is the substantive finding of this audit. Followed the CFL
cache-guard precedent's exact methodology
(`docs/CC-CMD-2026-07-05-cfl-scoreboard-cache-guard.md`): added a temporary
diagnostic threading `CF-Cache-Status` from the Kali fetch's response
through to the `pick_resolved` response, made two requests against the
same cache key (`kali:predictions:2026:18`, via two different picks —
Carlton and Hawthorn, both round 18) within the TTL window, then removed
the diagnostic per the same precedent's final step.

**Result — both requests showed `CF-Cache-Status: BYPASS`:**

```javascript
call1: { resolvedProbability: 0.588, probabilitySource: "kali", _kaliCacheStatus: "BYPASS" }
call2: { resolvedProbability: 0.412, probabilitySource: "kali", _kaliCacheStatus: "BYPASS" }
```

This is the opposite of the CFL precedent's result (`REVALIDATED` → `HIT`).
The `cf.cacheTtl`/`cacheEverything`/`cacheKey` directive on the Kali fetch
is currently a **no-op** — every request bypasses Cloudflare's cache
entirely, meaning `KALI_AFL_TOKEN`'s 5,000/day quota is not being shielded
at all, contrary to the caching commit's stated purpose.

**Most likely cause, not fully confirmed:** the Kali fetch includes an
`Authorization: Bearer ${kaliKey}` header. Cloudflare does not cache
responses to requests carrying an `Authorization` header by default, and
`cacheEverything: true` does not override this specific restriction (a
documented Cloudflare behavior, distinct from the content-type/status-code
eligibility rules `cacheEverything` does override). This same
`Authorization`-header pattern exists in `buildAFLJournalismContext`'s own
Kali call (`src/index.js`) — meaning the "proven pattern" this fix mirrored
may itself never have been actually caching, not just this port of it. That
claim is not independently verified in this session (would require testing
`buildAFLJournalismContext`'s own call path directly, out of scope
here) but is flagged as a real, likely-shared root cause worth a follow-up
check.

**Not fixed in this session.** A real fix (routing through the Workers
Cache API directly instead of `fetch()`'s `cf` shorthand, or restructuring
to avoid sending `Authorization` on the cached leg) is new implementation
work, not verification — explicitly out of scope for an audit CC-CMD, and
this session's own confidence score (below) reflects that this task's
goal — confirm cache-hit behavior — was not achieved, because the behavior
itself doesn't exist yet.

The directive was left in place in code (harmless — it's a no-op, not
actively wrong) rather than removed, since removing it wouldn't restore any
working behavior either; the honest comment now documents the actual state
instead of the prior speculative "should work" framing.

## Commits

- `6f76984` — temporary diagnostic added (CF-Cache-Status threading)
- `cdbc2a5` — diagnostic removed, finding preserved as a code comment

Both deployed successfully. No functional change to production behavior
beyond the comment update — the caching directive's actual (non-)behavior
is unchanged by this audit, only now accurately documented.

## Confidence Score

```
+25  All three fixes (date-range, scale normalization, caching) confirmed
     present, syntactically valid, and correctly composed -- met, no repair
     needed
+25  Live E2E test passes with correct 0-1-scale probability against a
     genuinely fresh fixture (Collingwood v North Melbourne, not reused) --
     met
+0   Cache-hit behavior was tested using the exact required methodology,
     but the test's result is that caching is NOT working (BYPASS, not
     HIT) -- the task asked to confirm hit behavior; the honest result is
     that hit behavior does not exist to confirm. This is not a process
     failure -- the test was executed correctly and produced a real,
     actionable answer -- but it cannot be scored as "demonstrated" when
     the demonstrated outcome is the opposite.
+20  Outbox honestly frames this as an audit of an out-of-process commit,
     accurately corrects the doc's authorship framing where verifiable,
     and reports the TASK 3 finding as a real defect rather than
     rationalizing the BYPASS result or omitting it -- met
= 70/100
```

**Score: 70/100 — below the 95 threshold. Per this CC-CMD's own
instruction: reporting verbatim and stopping. No fix to the caching defect
is attempted in this session — that is new implementation work requiring
its own CC-CMD, not an extension of this audit's verify-only scope.**

## What Needs a Follow-Up CC-CMD

- Fix the AFL Kali cache so it actually shields `KALI_AFL_TOKEN`'s
  5,000/day quota — likely requires either the Workers Cache API directly
  (bypassing `fetch()`'s `cf` object limitations around `Authorization`
  headers) or restructuring the request so the cached leg doesn't carry
  auth
- Independently check whether `buildAFLJournalismContext`'s own Kali call
  (`src/index.js`) has the identical BYPASS problem — if so, the "proven
  pattern" this fix mirrored has never actually been proven for caching,
  only for correctness of the returned data
