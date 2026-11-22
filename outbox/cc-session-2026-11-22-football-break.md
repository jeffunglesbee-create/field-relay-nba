# Session record: a football break served as `pre` (CC-CMD-2026-11-22-football-break-served-as-pre), Rule 67

Written 2026-11-22 on `main`, by the field-laboratory session that shipped live scores for the other sports. Found by the first real halftime body of the day.

## HEAD progression

| point | where | what |
|---|---|---|
| start | field-relay-nba `main` `85127fb` (docs) | `adaptESPNFootball` read only `STATUS_IN_PROGRESS` as live |
| fix | the commit that adds this file | a football break is live; `situation.isHalftime` |

## What was verified

- The defect on a real body: laboratory capture 2026-11-22 19:41:15Z, three NFL games at halftime served `pre` (CC-CMD, "What was measured").
- The fix on the real worker with a stubbed ESPN: `scripts/check-v2-games-nba-board.mjs` self-test 23 ok; `--mutate` 14 of 14 caught; three neighbouring checks pass.
- Not verified: the fix on a live halftime after deploy (CC-CMD done condition 2; the late games' halftime, about 22:20Z to 23:00Z; the laboratory's reminder reads it); the MLB adapter; CFB beyond the shared adapter.

## Integration state (Rule 65)

Relay contract: `situation.isHalftime` (boolean) on football `/v2/games` games, CONTRACTS.md "the other boards". Client consumer: field-laboratory `LiveFeed.decodeFeed` (`situation.isHalftime`, any sport) and `readingFor` (`HalfTime`). Status: STAGED until the post-deploy halftime read. Known mismatch: none expected; the page's `Half time` for football has not been seen.

## Incidents (Rule 77)

None in this change. The defect was shipped in the page change that read the other sports, whose evidence table said football halftime was not read; the premise was tested by the first halftime of the day and found true.
