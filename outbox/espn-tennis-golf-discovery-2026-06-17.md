# ESPN Scoreboard — Tennis & Golf Source Discovery
Date: 2026-06-17

## Finding

site.api.espn.com returns 200 for ATP, WTA, and PGA Tour scoreboards when
fetched from a Cloudflare Worker IP. Direct server requests 403. CF Worker
bypass already used for STAT (Workday/HiringCafe) and FIELD ESPN scoreboard.

## Verified endpoints (200 from CF Worker via html_probe)

ATP: https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard
     League ID 851, 2026 full season calendar

WTA: https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard
     League ID 900, 2026 full season calendar

PGA: https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard
     League ID 1106, full 2026 tournament schedule with event IDs

## Cost: $0

No new keys. No new subscriptions. Same ESPN scoreboard infrastructure
already in production for NBA, MLB, NHL, WC2026, EPL.

## Implementation

Add to V2_LEAGUES or equivalent ESPN handler:
  'atp' → sport: tennis, league: atp
  'wta' → sport: tennis, league: wta
  'pga' → sport: golf,   league: pga

URL pattern: https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard

Verify site.api.espn.com in CF network allowlist.
Parse tennis: sets, games, match status, current server.
Parse golf: position, toPar, today, thru, round, tournament name.

SlashGolf free (250/month) stays for LIV/DP World Tour/LPGA enrichment.

## Timeline

Wimbledon June 30. 13 days. Single CC session (~2hrs).

Drive doc: 13a9Z_yCpteFJeCSYNoE_6NDccWrtOxMB-pS0wan995w
