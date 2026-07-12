# session_health analytics_phases null-preserve — 2026-07-12

## PROBE BLOCK

```
$ grep -n "phases\[r.feature\]" src/index.js
13199:                                if (!phases[r.feature])
13200:                                    phases[r.feature] = { date: r.date, degraded: !!r.degraded };
```

Line shifted from the doc's informal `~12920-12940` reference (this
session's earlier `analytics-degraded-sweep` CC-CMD added a new route
above this block) — confirmed the real current line via grep, not
assumed from the doc.

**Response envelope**, found by searching forward from
`if (toolName === 'session_health')` (L13124) to its `return`:
```js
return respond(jsonrpc2({ content: [{ type: 'text',
    text: JSON.stringify(out, null, 2) }] }));
```
Standard MCP `tools/call` envelope — a JSON-RPC result whose `content[0].text`
is the JSON-stringified `out` object.

**Live-invocation pattern**: rather than reconstructing the JSON-RPC POST
`/mcp` call from scratch (the doc's suggested `mcp-oauth-probe.yml` STEP 10
legacy path), used this session's own already-connected
`mcp__FIELD_Handoff__session_health` tool — a thin live wrapper over this
exact deployed worker's `/mcp session_health` tool call (confirmed: its
output's `relay_head`/`relay_deployed`/`analytics_phases` fields match the
worker's own real code paths one-for-one). This is the same tool this
session already uses for `get_ci_status`/`get_deploy_status`-equivalent
live checks, satisfying the doc's "reuse the established pattern, don't
invent a new invocation method" instruction without needing a temporary
GitHub Actions workflow.

## Real D1 baseline (re-run fresh, not assumed from the doc's numbers)

Confirmed via direct D1 query before editing: of the phases with rows in
the last 14 days, only `night_stars` and (on Sundays) `contradiction`
ever include a `degraded` key; the rest never do. Matches the doc's
finding.

## TASK 1 — Fix applied

```diff
-                                    phases[r.feature] = { date: r.date, degraded: !!r.degraded };
+                                    phases[r.feature] = { date: r.date, degraded: r.degraded == null ? null : !!r.degraded };
```

Exactly mirrors the `wentToOT` null-preserve shape: no default value
substituted, `null` (key absent in source JSON) stays `null` in the
response; `0`/`1` still coerce to `false`/`true` for the phases that
actually compute the flag. `git diff` confirms a single-line change —
`brief_type`/`quality`/`deploy_match`/every other `out.*` field in this
handler untouched.

## TASK 2 — Verification

`node --check src/index.js` — clean.

**Real live `session_health` call, before and after deploy** (not
simulated):

Before (commit `a39c467`, pre-fix):
```
"night_stars":  { "date": "2026-07-11", "degraded": false },
"truth_is":     { "date": "2026-07-11", "degraded": false },
"jinx":         { "date": "2026-07-11", "degraded": false },
... (all 10 tracked phases: degraded: false, uniformly)
```
Matches the bug exactly: 9 phases that never compute the flag reported the
same `false` as a real "confirmed not degraded" signal.

Deployed the fix (`b300742`), confirmed via GitHub Actions API the
"Deploy RELAY Worker" run for that commit reached
`status:completed conclusion:success`.

After (commit `b300742`, post-fix), same tool, same live call:
```
"field_pick":        { "date": "2026-07-12", "degraded": null  }
"circadian_preview": { "date": "2026-07-12", "degraded": null  }
"night_stars":       { "date": "2026-07-11", "degraded": false }
"truth_is":          { "date": "2026-07-11", "degraded": null  }
"jinx":              { "date": "2026-07-11", "degraded": null  }
"morning_report":    { "date": "2026-07-11", "degraded": null  }
"circadian_late":    { "date": "2026-07-11", "degraded": null  }
"streak_board":      { "date": "2026-07-11", "degraded": null  }
"quality_feedback":  { "date": "2026-07-11", "degraded": null  }
"quality_alert":     { "date": "2026-07-11", "degraded": null  }
```
9 of 10 phases correctly flipped to `null`; `night_stars` — the one
feature that genuinely computes the flag — correctly still reports a real
boolean (`false`, confirmed not degraded on 2026-07-11). `deploy_match`
also flipped to `true` in the same response, confirming the call hit the
just-deployed code, not a stale cached response.

## DONE CONDITION

Met: the coercion no longer collapses "no degraded key in this feature's
JSON" and "confirmed not degraded" into the same value, live-verified
against two real `session_health` calls (immediately before and after
deploy), not simulated.

## Confidence Score

```
+20  Probe confirmed the real current line (shifted from the doc's
     informal reference, found via grep not assumed) and the real
     response envelope shape (read forward to the actual `return
     respond(jsonrpc2(...))` call)
+25  Replacement exactly mirrors the wentToOT null-preserve pattern --
     null stays null, no default substituted, 0/1 still coerce normally
+10  node --check clean
+30  Live-verified against two real session_health calls (before/after
     deploy, not simulated) -- captured the actual bug live (all 10
     phases uniformly false) then the actual fix live (9 correctly null,
     night_stars correctly still a real boolean)
+15  git diff confirms exactly one line changed; no other out.* field in
     the session_health handler touched
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `b300742` — the fix: null-preserve `degraded` in session_health's
  `analytics_phases` builder
- (this commit) — this outbox, written after live before/after
  `session_health` verification
