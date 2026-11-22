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
- Verified after deploy (22:30:39Z): the fix on a real halftime, Jets at Chargers `live` Q2 `0:00` with `isHalftime` true (done condition 2), and the card saying `Half time` on the field-laboratory page at 22:31:00Z (done condition 3). Not verified: the MLB adapter; CFB beyond the shared adapter.

## Integration state (Rule 65)

Relay contract: `situation.isHalftime` (boolean) on football `/v2/games` games, CONTRACTS.md "the other boards". Client consumer: field-laboratory `LiveFeed.decodeFeed` (`situation.isHalftime`, any sport) and `readingFor` (`HalfTime`). Status: VERIFIED on the deployed page for football (22:31:00Z). Known mismatch: none expected; the page's `Half time` for football has not been seen.

## Incidents (Rule 77)

None in this change. The defect was shipped in the page change that read the other sports, whose evidence table said football halftime was not read; the premise was tested by the first halftime of the day and found true.

## Addendum, the same evening

21:41:15Z, the first NBA halftime body: `live`, `Q2`, `0.1`, no flag. The basketball adapter now carries `situation.isHalftime` as the football one does (board check N9, 15 of 15 mutations caught). Verification after deploy: the next NBA halftime (about 23:55Z); the status name ESPN uses is not read.
