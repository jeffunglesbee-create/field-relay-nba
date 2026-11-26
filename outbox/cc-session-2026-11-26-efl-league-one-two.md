# Session 2026-11-26 — EFL League One and League Two seeded; the EFL Trophy left as it is (owner: "go with Claude's best recommendations")

**Owner order:** for the two open items of the previous report (League One and League Two seeding; the EFL Trophy), "go with Claude's best recommendations, and state what they are". Spec: `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`, "Addendum 2026-11-26, part 2". Branch main in field-relay-nba and jubilant-bassoon (the client checkout was on `claude/start-session-vlyozi`; its CLAUDE.md says commit to main, so the docs commit was made there). No PR. Worked solo.

## Decisions (each with its evidence, in the addendum)

1. **Seed League One and League Two.** The product already writes briefs for their games (208 and 94, all `source` client, none cron) while no game row existed; the V2 routes, labels, morning-report family and `LOWER_SOCCER` already carried both; only the `LEAGUES` row was missing; cost is one scoreboard read a day plus about two short Haiku briefs per game played after the seed; reversible.
2. **No BSD id and no BSD join for either.** BSD has League One (86) and League Two (87), but nothing reads a `bsd_event_id` on these rows and an id switches on the endgame capture. Unblocked when a consumer asks.
3. **EFL Trophy: no change.** BSD holds none of its matches (0 of 98). The detector is the existing monthly `bsd-leagues-baseline.yml` diff; the addendum names the verify command. No session poll armed (it would cost a session a month to watch something nobody needs yet).

## What was built

| commit | what |
|---|---|
| `efa06fa` | `LEAGUES` rows `eng.3` `EFL League One` and `eng.4` `EFL League Two`; manifest has nothing UNDECIDED in the EFL pyramid; pinned count 24 -> 26; label-contract allowlist emptied; registry comment corrected (BSD holds leagues 86 and 87) |
| data | history backfills: League One 179 rows, League Two 188 rows, 0 failed (runs `45862012111`, `45862018532`; dry runs `45861264126`, `45861270864`: 117 of 117 scoreboards 200 each) |
| docs | addendum part 2; this doc; HANDOFF; jubilant-bassoon `5c8eda9` (the client CC-CMD) |

## Verified end to end (Rule 61)

- **Archive** (reader run `45862908281`, `outbox/archive-label-dates-2026-11-26T16-53-49-531Z.json`): EFL League One 179 rows (30 dates, 2026-08-15 to 2026-11-24), EFL League Two 188 (21 dates), joined 0 and 0 as decided; EFL Championship 204 / 204 unchanged; EFL Trophy 98 / 0.
- **Checks on the change:** seed coverage 8 of 8, seeded labels 2 of 2, LEAGUES count 26, label contract, brace, doc citations, KV and route provenance, empty-catch baseline 112, `mutate-seed-coverage` 6 mutations, the five in-place identity harnesses (clean tree).
- **Deploy:** Deploy RELAY Worker run `45861985679` on `efa06fa`, success (it includes `check-archive-date-keying.mjs` against the new rows); Repo guards `45861985700`, success.
- **Not run here, runner-only:** `check-archive-date-keying.mjs` needs `RELAY_SHARED_SECRET`; it is in the deploy job and runs against the new rows there.
- **STAGED (Rule 74):** the cron's yesterday catch-up writing a League One or Two final on its own, and the cron's briefs for them. Blocked: no League One or Two match has been played since the deploy. Unblocked at the next English midweek or Saturday slate. Verify: the next `read-archive-label-dates.yml` run with `like` = `EFL League%` shows a `lastDate` after 2026-11-24 and `/archive/query?sport=EFL%20League%20One&source=cron` a non-zero `total`.

## Found, not in scope, and filed (Rule 87.4)

The client's Night Owl briefs for soccer: "a 4-points margin" for a 4-0 league match, "a 0-points margin" for a 1-1 draw, "series record" in league fixtures; both "points" and "goal" for the same sport. Read in the code (two `includes('soccer')` unit chains in `src/legacy/field.js`, with `_sport` usually a display label) and filed as jubilant-bassoon `docs/CC-CMD-2026-11-26-night-owl-soccer-margin-unit.md`. **Not patched:** the set of `_sport` strings on the live page is unmeasured and the same sport already shows both units; its Task 0 measures it first (a count of the wording per label, and a Playwright read of `_sport` through the CI-as-proxy pattern).

## Errors found and fixed, matter-of-fact

- A draft of the addendum carried a run id I had not read (`45862200000`); replaced by the real reader run before anything was committed.
- The first commit of the client CC-CMD was blocked by that repo's hook because its checkout was on a session branch; switched to `main` per its CLAUDE.md and committed there.
