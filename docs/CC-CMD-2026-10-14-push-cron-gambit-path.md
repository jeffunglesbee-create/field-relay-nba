# Claude Code Command — the push cron's live-game poll is refused by its own route

**Date:** 2026-10-14
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (dead path) — touches push, so ADR-002 Rule A applies
**Status:** **DONE 2026-10-19** — option 1 landed as `32f7b596`..`2ebddc86`. Deploy run 39194042279 is green, with the absence guard passing in it. All three done-condition probes pass. Session doc: `outbox/cc-session-2026-10-19-push-cron-gambit-path.md`. The client half is filed as jubilant-bassoon `docs/CC-CMD-2026-10-19-sw-score-change-has-no-producer.md`. One ADR-002 question stays open for the owner; see the correction under the ruling.

## What was measured

Found by the 2026-10-14 ESPN inventory (workflow `wf_e4283b41-c05`), then
checked against source at `ec97b3e`:

- `handleCron` polls, for each of the 8 entries in `SPORT_CONFIG`
  (`src/analytics-engine.js:46-53`),
  `${RELAY}/espn-gambit/apis/site/v2/sports/${cfg.path}/scoreboard`
  (`src/index.js` ~5517), and `if (!r.ok) continue`.
- `/espn-gambit/*` (`src/index.js` ~17337) refuses any path for which
  `espnGambitAllowed` is false, with 403 and
  `X-RELAY-Error: espn-gambit-path-not-whitelisted`.
- `espnGambitAllowed` (`src/index.js:908`) is
  `path.startsWith('/apis/v1/challenges/')`. Executed with node on the cron's
  paths: `/apis/site/v2/sports/basketball/nba/scoreboard`,
  `.../football/nfl/scoreboard`, `.../soccer/eng.1/scoreboard` all `false`.

So every poll is refused, every iteration `continue`s, and `live` stays empty:
the live-game half of the push heartbeat collects nothing. Since when is
UNMEASURED; the clone's history is shallow.

Even an allowed path would not help as written: `/espn-gambit` proxies
`ESPN_GAMBIT_BASE` (gambit-api-partner.fantasy.espn.com), not the site API
the path names.

## Why this is the owner's decision

The dead path is the one that would push live close-game notifications.
ADR-002 Rule A says the relay serves on pull and never pushes a value-based
alert unprompted. Restoring it could reopen exactly that question, so the
first decision is whether this loop should exist at all.

1. **Delete the loop** and its `SPORT_CONFIG` gates from the cron, if push of
   live games is not wanted. No behaviour changes, since it does nothing now.
2. **Repair it**: poll `${ESPN_API_BASE}` directly (the same host as
   `/v2/games`), after an ADR-002 review of what it pushes.
3. Leave it, and record why a loop that cannot succeed stays.

## Ruling, 2026-10-18 (owner, delegated: "go with Claude's best recommendations")

**Option 1. Delete the loop and its `SPORT_CONFIG` gates from the cron.**

Three reasons, and the third is the one that decides it.

1. **Deletion changes no behaviour**, because the loop already does nothing:
   every poll 403s on `espn-gambit-path-not-whitelisted`, every iteration
   `continue`s, `live` stays empty. It is the safest change available.
2. **Repair reopens a settled ruling for a feature nobody has missed.** Option 2
   requires an ADR-002 review of what the loop would push, and ADR-002 Rule A
   has already answered it: the relay serves on pull and never pushes a
   value-based alert unprompted. Restoring a value-based live-game push means
   relitigating that to regain something absent for an unmeasured period with
   no one noticing.
3. **Option 3 is the only genuinely bad choice.** `continue` on a 403 is
   indistinguishable from `continue` on "no live games". That is the Rule 99
   shape at system level — an absence wearing the costume of a value — and this
   path held that disguise long enough that nobody noticed, which is the
   evidence it would hold it again.

**Amendment to the done condition: delete it as a STATED absence.** A silent
removal leaves a future session to read the gap as an oversight and restore it.
Record, beside the code the deletion touches, one line saying that the
live-game half of the push heartbeat does not exist and why (ADR-002 Rule A,
and this ruling). The string check below then guards the decision and not only
the deletion.

## Correction, 2026-10-19 (CC, at dispatch; the ruling above is unaltered)

The ruling's second reason says ADR-002 Rule A "has already answered" a
late-and-close relay push. jubilant-bassoon `docs/ADR-002-CONTEXT.md`
**Rule B** says the opposite: the relay's boolean `latePhase && closeGame`
gates "remain free to trigger the existing `SCORE_CHANGE` push path directly,
exactly as before". The adversarial review of the deletion found this, and it
was confirmed against the ADR text.

- **The decision stands without that reason**, on reasons 1 and 3: deleting
  changed no behaviour, and a `continue` on a 403 that reads as "no live
  games" is the shape most likely to hide again.
- **The ADR-002 question is open, and it is the owner's.** Is a relay push
  gated by raw-state booleans permitted (Rule B), or is it an unprompted
  value-based alert (Rule A, as reason 2 read it)? Code comments do not settle
  patent-compliance questions (Rule 45). The stated-absence paragraph in
  handleCron records the disagreement and says a restore needs it resolved
  first.

## Done condition

Option 1: no `espn-gambit/apis/site` string in `src/`, the stated-absence note
present beside the deletion, and a deploy green.
Option 2: one cron tick's log shows at least one sport's scoreboard read with
HTTP 200, and the ADR-002 review is written down beside the code.
