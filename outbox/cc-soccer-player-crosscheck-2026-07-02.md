# Outbox — Soccer Player Cross-Check (BSD ↔ ESPN)

**Date:** 2026-07-02
**CC-CMD:** docs/CC-CMD-2026-07-02-soccer-player-crosscheck.md
**Status:** SHIPPED (script + workflow committed; full data run is chat-side via workflow_dispatch)

---

## Task 1 — Cross-Referenceable Competitions

Enumerated from `src/index.js` league config table (lines 971–995).

### Included (bsdLeagueId != null AND espnLeague present)

| key         | bsdLeagueId | espnLeague            | season  | testable (2026-07-02)          |
|-------------|-------------|-----------------------|---------|-------------------------------|
| epl         | 1           | eng.1                 | 2026    | No — 2026-27 not yet started  |
| mls         | 18          | usa.1                 | 2026    | Possibly — season in progress |
| ucl         | 7           | uefa.champions        | 2026    | No — 2026-27 not yet started  |
| europa      | 8           | uefa.europa           | 2026    | No — 2026-27 not yet started  |
| conference  | 8           | uefa.europa.conf      | 2026    | No — 2026-27 not yet started  |
| eflchamp    | 12          | eng.2                 | 2026    | No — 2026-27 not yet started  |
| laliga      | 3           | esp.1                 | 2026    | No — 2026-27 not yet started  |
| seriea      | 4           | ita.1                 | 2026    | No — 2026-27 not yet started  |
| bundesliga  | 5           | ger.1                 | 2026    | No — 2026-27 not yet started  |
| ligue1      | 6           | fra.1                 | 2026    | No — 2026-27 not yet started  |

### Excluded (no bsdLeagueId — ESPN-only, nothing to cross-check)

| key     | reason                                      |
|---------|---------------------------------------------|
| eflone  | bsdLeagueId: null — ESPN-only competition   |
| efltwo  | bsdLeagueId: null — ESPN-only competition   |

### Special case: wc26

Config entry: `{ sport: 'football', leagueId: 1, season: '2026', espnLeague: 'fifa.world' }` — no `bsdLeagueId` field. BSD events are accessed via event ID directly (not by league ID). Group stage confirmed finished; BSD event 8346 confirmed to have `average_positions` data via CC-CMD probe. Script handles wc26 via `WC26_EVENT_IDS = [8346]` — the primary test target.

---

## Task 2 — Script

**`scripts/soccer-player-crosscheck.js`** — standalone Node.js script.

Design decisions:
- `extractSurname` is standalone (not imported from `identity-resolver.js`) — the soccer algorithm (strip leading initials) is structurally different from MLB `_stripPlayer` (suffix-stripping: Jr/Sr/II/III/IV irrelevant for soccer). Evaluated importing and rejected.
- ESPN roster approach: fetch all teams in the league, then all rosters. Bounded per competition (e.g. ~32 teams × ~23 players for WC26). Acceptable for a periodic audit tool.
- WC26 handled specially: no BSD season endpoint needed; known event ID used directly.
- Collision check: per-event BSD dataset — flag any candidate where another BSD player in the same dataset shares the same normalized surname.
- Rate limiting: 250ms delay between ESPN roster fetches.

Output: `outbox/soccer-player-crosscheck.json` with keys `candidates`, `unmatched`, `untestable`.

---

## Task 3 — Inline Assertions

Three exact real BSD samples verified in CC-CMD, run before any network calls:

```
PASS [T. Weah → Weah]
PASS [B. A. Yılmaz → Yılmaz]
PASS [N. Da Costa → Da Costa]
```

Confirmed passing: verified independently via `node -e` in this session.

---

## Task 4 — Verification

```
node -c scripts/soccer-player-crosscheck.js
```
Exit 0 — syntax valid.

YAML check on `.github/workflows/soccer-player-crosscheck.yml`:
```
YAML valid
trigger: ['workflow_dispatch']
```

---

## Task 5 — Known Limitations / Untestable Competitions

The script will log `untestable` entries for:

- `epl`, `ucl`, `europa`, `conference`, `eflchamp`, `laliga`, `seriea`, `bundesliga`, `ligue1` — 2026-27 European domestic season has not started as of 2026-07-02. Confirmed via CC-CMD probe: `/bsd/events/season?league=1&season=2026` returned only `status: "notstarted"` fixtures dated 2027.
- `mls` — season 2026 is in progress; script will attempt to find a finished event and proceed if found.
- `wc26` — testable; group stage complete. BSD event 8346 is the primary test event.

---

## Chat-Side Follow-Up

1. Trigger `Soccer Player Crosscheck` via `workflow_dispatch` (WC26 group stage is the test target).
2. Review `candidates` output — especially `collision_risk: true` entries — before adding any entries to `CANONICAL_PLAYER`'s `type: 'soccer_player'` entries.
3. Soccer surnames (Costa, Silva, Santos) carry materially higher collision risk than the MLB run. Expect a lower accept rate than the MLB run's 11/22.
4. MLS: if the workflow finds a finished MLS event, review those candidates separately — MLS rosters include players from many nationalities with diverse surname patterns.
