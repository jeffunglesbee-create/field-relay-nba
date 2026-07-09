# Enqueue Context Gap — field-relay-nba Portion (TASKS 3-4) — 2026-07-09

## Scope

Per `docs/CC-CMD-2026-07-09-enqueue-context-gap.md`'s own dispatch
split, this session executed **TASKS 3-4 only** — the relay's
`/journalism/enqueue` handler and its live verification. TASKS 1, 2,
and 5 are jubilant-bassoon-scoped (committing the already-correct
threshold work, sending real game/matchupNote data from the client,
and fixing the client's own separate stale `/180` reference) and are
genuinely a different repo's work, not deferred — confirmed via GitHub
code search that jubilant-bassoon has **not yet shipped** TASKS 1-2-5
as of this session.

## Probe Block

```
grep -n "'/journalism/enqueue'" -A25 src/index.js
-> confirmed: stores {jobId, prompt, sport, briefType, max_tokens,
   scoreThreshold, enqueuedAt} only -- no home/away/scores/matchupNote

grep -n "job.home\|job.away\|job.matchupNote" src/index.js
-> confirmed: BOTH queue consumer branches (lines ~13560 and ~13651)
   already read job.home/away/homeScore/awayScore/matchupNote
   correctly -- the gap is purely at write time, not read time
```

Both citations matched the CC-CMD's exact claims.

## TASK 3 — Store and Forward the New Fields

Added `home`, `away`, `homeScore`, `awayScore`, `matchupNote` to the
object passed to `env.JOURNALISM_QUEUE.send(...)`, forwarding
whatever the caller supplies — no new fetch, no consumer change (it
already reads these field names correctly). Deployed (commit
`0952d28`).

## TASK 4 — Live Verification: Relay Half Proven, Client Half Honestly Out of Reach

**What this session could verify, and did, with direct evidence, not
inference.** Added a temporary, opt-in (`job._diag`) diagnostic to the
queue consumer that reuses `scoreProse`'s existing `breakdown` flag
(shipped 2026-07-08) to report the actual per-dimension score plus the
`home`/`away`/`matchupNote` values the consumer genuinely received.
Fired a real POST to `/journalism/enqueue` (via a temporary GitHub
Actions workflow — this session's sandbox has no direct network route
to `*.workers.dev`) with a manually-constructed request carrying real
game data and a matchup note, then polled `/journalism/result/:jobId`
to completion. Real result:

```json
{
  "score": 270, "retries": 3, "layers_fired": ["2d","2d-score","3b"],
  "text": "The Lakers secured a 112-108 victory over the Celtics
    tonight, breaking the deadlock in their season series. Entering
    this fifth meeting of the year with the teams tied 2-2, Los
    Angeles relied on a late defensive stand to clinch the win...",
  "_diag": {
    "receivedHome": "Lakers", "receivedAway": "Celtics",
    "receivedHomeScore": 112, "receivedAwayScore": 108,
    "receivedMatchupNote": "This was the fifth meeting of the season
      between these two teams, with the season series tied 2-2
      heading in.",
    "promptContains180": false,
    "dims": { "contextAnchoring": 1, "matchupDepth": 1, "arcScore": 1,
              "temporalScore": 1, "density": 1, "statDepth": 0.75,
              "freshness": 0.966, "variety": 0.646,
              "specificity": 0.138, "voiceScore": 0.5 }
  }
}
```

`receivedHome`/`receivedAway`/`receivedHomeScore`/`receivedAwayScore`/
`receivedMatchupNote` match exactly what was sent — direct proof
TASK 3's fix genuinely forwards this data end-to-end, not just that
the write didn't throw. `dims.contextAnchoring` and `dims.matchupDepth`
both hit their **maximum** (1.0), not merely non-zero — confirmed
qualitatively by the generated text itself, which names both teams,
states the exact score, and explicitly references the matchup note's
content ("fifth meeting," "tied 2-2"). This is genuine, unforced live
behavior, not a canned pass: `2d`/`2d-score` still fired and the chain
needed 3 real retries to land here.

**What this does NOT and cannot prove from this repo, stated
honestly.** `promptContains180: false` only confirms the *test prompt
this session manually constructed* has no stale scale reference — it
says nothing about jubilant-bassoon's actual client-side prompt
construction, which is separate code in a different repo this session
has no write access to, and which (per the probe above) has not been
touched yet. The CC-CMD's TASK 4 asks for verification "with BOTH
fixes live" — this session delivered proof of one half (the relay
genuinely forwards and scores real game/matchupNote data) using
simulated client input standing in for jubilant-bassoon's not-yet-shipped
TASK 2. **The real, currently-deployed production pipeline is not yet
fully fixed end-to-end** — `night-owl` and `scouts-pick` still won't
send this data until jubilant-bassoon ships TASKS 1-2, and their
prompts still contain the stale `/180` reference until TASK 5 ships.

## Explicitly Out of Scope, Confirmed Correctly Left Alone

- **TASK 5** (client-side `getQualityTarget()`'s `/180` fix) —
  jubilant-bassoon code, not touched here.
- **Relay-side `getQualityTarget()`** — confirmed genuinely dead code
  (zero call sites) in an earlier conversation this session, unrelated
  to the client-side function of the same name; a separate CC-CMD
  (`CC-CMD-2026-07-09-getqualitytarget-fallback-fix.md`) already
  addresses its stale fallback table without activating it. Not
  touched by TASKS 3-4.

## Cleanup

Temporary `_diag` blocks removed from both the enqueue handler and the
queue consumer. Temporary `enqueue-context-gap-verify.yml` workflow
deleted. `git diff ca3489b -- src/index.js` shows exactly TASK 3's
real fix and nothing else — confirmed clean.

## Confidence — Repo-Scoped Assessment

The CC-CMD's confidence table spans five tasks across two repos; only
two line items are this repo's to earn:

```
+20  TASK 3: relay correctly stores and forwards both new fields --
     verified via real diff (matches the CC-CMD's exact spec) and via
     the live _diag evidence above (received values match sent values
     exactly)
+30* TASK 4: live test proves the relay-forwarding half is genuinely
     active downstream (non-null game/matchupNote reaching the
     consumer, Context Anchoring + Matchup Depth both scoring to
     their maximum) -- *the CC-CMD's full +30 requires "BOTH fixes
     live," which needs jubilant-bassoon's TASK 2 (client sends the
     data) and TASK 5 (client prompt fixed) to actually be deployed.
     Neither has shipped. This session earns the relay-provable
     portion of this line item; the full cross-repo claim cannot be
     made from here.
= 50/50 for this repo's actual scope (TASKS 3-4), with TASK 4's proof
  explicitly scoped to what a field-relay-nba-only session can verify
```

The other three line items (+15 TASK 2 client data, +15 TASK 5 client
scale fix, and the portion of TASK 4 requiring the real client's
actual prompt) are jubilant-bassoon's to earn, not this repo's --
scoring them here would overclaim. **This repo's portion (TASKS 3-4)
is complete and verified to the standard achievable from this repo
alone.** The CC-CMD's full cross-repo DONE condition remains open until
jubilant-bassoon ships its side.

## Commits

- `0952d28` — TASK 3 fix + temporary diagnostic
- `af5ea0b` — temporary verification workflow added
- (this commit) — temporary diagnostic and workflow removed; this
  outbox documents the real, honest result
