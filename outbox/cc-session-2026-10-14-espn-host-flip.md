# CC session — 2026-10-14 — ESPN moved its Worker block; one regression of mine

Opened by the 18:30Z daily read of the odds watches. silently-dead-crons
named two NEW reds in this repo, and both were real.

**CC-CMDs:** `docs/CC-CMD-2026-10-14-espn-host-flip.md` (Task 1 DONE, 2-4 open);
`docs/CC-CMD-2026-10-14-archive-game-unauthenticated-write.md` (new, owner
decision); `docs/CC-CMD-2026-08-25-rotate-relay-secret.md` (step 1c completed).
**HEAD:** `7782d77` → `41dfb4b` → `8f2cea9` → `2142bad` → `84b3a40` → `c6f094a`
→ this commit (docs). jubilant-bassoon: `d991edb9`.
**Credits:** 0. Dispatches, all free: `espn-host-parity-probe.yml`,
`espn-reachability-monitor.yml`, `deploy.yml` (identical source, to run its
verify job).

## Per commit

| commit | what |
|---|---|
| `41dfb4b` | verify-pending-checks: `os.environ['RELAY_SHARED_SECRET']` in its Python heredoc, replacing the JavaScript form `17b966d` wrote there |
| `8f2cea9` | `scripts/probe-espn-host-parity.mjs` + `espn-host-parity-probe.yml`: both ESPN hosts, each endpoint kind the relay reads, the relay's own headers, deep key-set diff; self-test 4/4, three mutations caught |
| `2142bad` | five ESPN literals re-pointed to site.api; route-provenance regenerated; CC-CMD filed |
| `84b3a40` | five base64-hidden secret literals converted to env; `check-exposed-secrets` decodes base64 (two self-tests; decode removed → red; literals restored → 38 > 33) |
| `c6f094a` | bridge probe query: `IN (subquery)` instead of a per-brief JOIN scan |
| jb `d991edb9` | the same base64 pass in jubilant-bassoon's checker |
| this | daily read, two CC-CMD updates, the archive-game CC-CMD, HANDOFF x2 |

## Verified vs STAGED

| thing | state |
|---|---|
| verify-pending-checks failed on `NameError: name 'process'` | **VERIFIED** — job log, run 38602768930; reproduced locally |
| the fix gets past the header line | **VERIFIED** locally (reaches urlopen) |
| the fix on a runner | **VERIFIED** — scheduled run 38640918363 (2026-10-14T21:31Z): `completion-trigger briefs: 21`, then `codex write status=200`, `Logged to codex — condition newly confirmed.` The next scheduled run, 38680771157 (2026-10-15T04:18Z), is also green |
| site.web.api 403s the Worker; site.api lets it in | **VERIFIED** — html_probe, five paths |
| the two hosts serve the same payload | **VERIFIED** 9 of 9 pairs, run 38617840250; soccer summary UNMEASURED |
| the relay's ESPN reads work after the deploy | **VERIFIED** — nfl/epl `espn-wc`, `/espn-summary` 200 683288 B, monitor 38619780577 green |
| five base64 sites use the Actions secret | **VERIFIED** — deploy 38620645051 verify steps 5/8/10/13 green; rule90 run 38620611419 read D1 |
| bridge probe query | **VERIFIED** — 1 s step (was 13-21 s), `PASS: brief_text populated for espn:401915415` |
| host-swap premise, adversarially | refuted AS WORDED by the audit: the swap cannot reach the five `sports.core.api` reads. Everything the swap did touch is verified above |
| independent audit of both conversion commits | workflow `wf_e4283b41-c05`: relay 89 of 89 secret-reading files mapped to their steps; jb 4 of 4 converted sites run; findings confirmed by refuters are the five base64 sites and known-vpc, both fixed |

## Not done, and where it lives

- ESPN resilience, `sports.core.api` 403, monitor blind spot: the ESPN CC-CMD,
  Tasks 2-4.
- `/archive/game` auth: its own CC-CMD, owner decision.
- The push cron's live-game poll is refused by `/espn-gambit`'s own allow-list,
  so it collects nothing: `docs/CC-CMD-2026-10-14-push-cron-gambit-path.md`,
  owner decision (ADR-002 Rule A).
- `sports.core.api` readers: five, not two. Two answer `ESPN 403`, two are
  silent empties; the ESPN CC-CMD's Task 3 now lists them with live results.
- jb's manifest prose still says "Nine occurrences"; the count line is 5. The
  rotation's step 5 rewrites that file.
- jb's copy of `workers/field-claude-proxy` is not deployed by any jb workflow
  and differs from the relay's by 232 lines. Recorded, not changed (Rule 69).
