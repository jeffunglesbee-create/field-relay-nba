# Live-Test Remaining Sports — 2026-07-08

Follow-up to the durability CC-CMD (`febecef`), which deferred live-testing
NBA, NHL, EPL, La Liga, Bundesliga, Serie A, NFL, UFL, AFL, IPL. No code
changes in this note — verification only.

## Key finding: futures markets make most of these testable right now

The odds-api branch doesn't require a live/imminent game — it only needs a
posted market with real team names and bookmaker odds. Exactly like the CFB
futures test from the sport-normalization CC-CMD, five sports already have
active markets weeks ahead of their season openers:

| Sport | Result | Source |
|---|---|---|
| EPL | `resolvedProbability: 0.929` | odds-api |
| La Liga | `resolvedProbability: 0.598` | odds-api |
| Bundesliga | `resolvedProbability: 0.848` | odds-api |
| Serie A | `resolvedProbability: 0.712` | odds-api |
| NFL | `resolvedProbability: 0.637` | odds-api |

All five confirmed live via the actual `pick_made`/`pick_resolved` relay flow
with real client display labels (`"Premier League"`, `"La Liga"`,
`"Bundesliga"`, `"Serie A"`, `"American Football (NFL)"`).

## Real finding: AFL resolves to the wrong branch outcome, not "untested"

`sport: "Australian Football (AFL)"`, `predictedWinner: "Fremantle Dockers"`
(a real team from a genuine near-term odds-api AFL fixture, commence
2026-07-09) reached the Squiggle branch — confirmed via `wp-resolution-failures`
codex, which recorded it as a genuine failure (not `wp-sport-label-drift`,
confirming `isWpUnsupportedSport`/`normalizeSportCode` correctly classified
AFL as a real, supported sport) — but `resolveWinProbability` returned `null`.

**Root cause not diagnosed in this session.** This sandbox's outbound proxy
returns `403 Forbidden` on any direct request to `api.squiggle.com.au`
(confirmed via `curl -v`), so neither the browser tool nor direct shell
access can inspect Squiggle's actual team-name format to compare against
`"Fremantle Dockers"`. Only the deployed relay Worker (running in
Cloudflare's network, not this sandbox) can reach Squiggle — this needs
either a relay-side self-probe route or a session with unrestricted egress
to `api.squiggle.com.au` to diagnose properly. The likely hypothesis (not
verified): Squiggle's `team=` query param expects a different name format
(e.g. `"Fremantle"` without `"Dockers"`) than the odds-api team name, and
`teamNameMatch()`'s prefix-based fuzzy matching isn't applied to Squiggle's
`team=` filter itself (only to the response's `hteam` field afterward) — so
a mismatched filter returns zero tips before matching logic ever runs. This
is a real, live-confirmed gap, not a hypothetical.

## Genuinely blocked — zero data available, not a code issue

| Sport | odds-api games | Status |
|---|---|---|
| NBA | 0 | Confirmed offseason |
| NHL | 0 | Confirmed offseason |
| UFL | 0 | Season concluded for the year |
| IPL | 0 | Season concluded for the year (typically March-May) |

No test possible until each sport's market reopens. Given cron auto-expires
after 7 days and these are weeks-to-months out, no automated recheck was
scheduled — revisit via a future session when each sport's odds-api market
shows `count > 0` (quick check: same request pattern used in this session,
`GET https://api.the-odds-api.com/v4/sports/{key}/odds?...`).

## Status of the 10 originally-deferred sports

- **Confirmed working (6):** EPL, La Liga, Bundesliga, Serie A, NFL (this
  session), AFL is *reached* but needs the Squiggle diagnosis above
- **Genuinely blocked, no data (4):** NBA, NHL, UFL, IPL

This is exploratory verification, not a fix — no code was changed, no
commit confidence gate applies. The AFL finding is a real follow-up
candidate for a future CC-CMD once Squiggle's team-name format can be
inspected directly.
