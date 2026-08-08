# CC-CMD-2026-08-08-fa-cup-coverage

Wire the FA Cup (`eng.fa`) into relay + client, following the pattern
already proven twice: `eng.league_cup` (EFL Cup) and `eng.trophy` (EFL
Trophy). This exists as its own CC-CMD rather than being executed in the
EFL Trophy session because of a real external block, stated below with
its unblock criterion (Rule 74) — not because the work was deferred.

## Why this is blocked, and what unblocks it

Probed 2026-08-08 from CF-Worker egress
(`site.web.api.espn.com/apis/site/v2/sports/soccer/eng.fa/scoreboard?dates=20260801-20261031`,
HTTP 200):

```
id 3918, "English FA Cup", slug eng.fa
season: { year: 2025, displayName: "2025-26 English FA Cup",
          type: { name: "Final" } }
events: []
```

The distinguishing fact versus the EFL Cup case: it is not merely that
`events` is empty for a future round — for `eng.fa` **ESPN's league
`season` object itself is still the finished 2025-26 season sitting at
type `Final`.** ESPN has not rolled this competition over to 2026-27 at
all. Compare `eng.trophy` probed in the same minute, which returned
`season.year: 2026`, `"2026-27 EFL Trophy"`, type `Group Stage`, with
real fixtures. Wiring `eng.fa` against a season ESPN has not opened
would ship a permanently-empty section with no way to verify it
end-to-end (Rule 61), and no way to confirm the label the adapter
actually emits.

**UNBLOCKED WHEN** the probe below reports `season.year` 2026 (or later)
— i.e. ESPN opens 2026-27. FA Cup First Round Proper is historically
early November, and qualifying rounds are typically not carried by ESPN,
so expect this around Oct–Nov 2026.

**Unblock probe (run this first; if it still says 2025, stop and change
nothing):**

```
mcp html_probe -> https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.fa/scoreboard
  assert leagues[0].season.year >= 2026
  assert leagues[0].season.type.name != "Final"
```

`html_probe` rather than curl: this sandbox's proxy returns
`CONNECT tunnel failed, response 403` for ESPN hosts (confirmed
2026-08-08 via `curl -sS`), and `site.api.espn.com` additionally 403s
Cloudflare Worker egress — which is why the relay was re-pointed to
`site.web.api.espn.com` in the ESPN P0 fix. Use `ESPN_API_BASE` from
`src/index.js`, do not write the host from memory.

## Tasks

1. **Probe block.** Run the unblock probe above. Then re-read, from
   current HEAD rather than from this document:
   - `src/index.js` — the three `efltrophy` sites (`V2_LEAGUES`,
     `SOCCER_LEAGUE_LABELS`, and `LEAGUES` inside
     `handleJournalismCycle`). `grep -n "efltrophy" src/index.js`.
   - `src/legacy/field.js` (jubilant-bassoon) — the `eng.trophy` entry
     in `SOCCER_LEAGUES`.
   Record the real ESPN `id`, `slug`, and first fixture date.

2. **Relay half, deployed first (Rule 70).** Add the same three coupled
   entries, keyed `facup`:
   - `V2_LEAGUES.facup` → `espnLeague: 'eng.fa'`, `bsdLeagueId: null`
     (do not invent a BSD id — Rule 2), `season` per the probe
   - `SOCCER_LEAGUE_LABELS.facup = 'FA Cup'`
   - `LEAGUES` (journalism cron) → `{sport:'soccer', league:'eng.fa', label:'FA Cup'}`

   The two label strings must be **byte-identical**. Three archive-write
   sites send `sport: gm.league`; that value persists into the archive
   `sport` column and leads the archive id, so a mismatch splits one
   competition across two id namespaces — the exact cleanup
   `CC-CMD-2026-07-15-wc-label-fragmentation` had to perform for WC26.

   `'FA Cup'` and not ESPN's `"English FA Cup"`: consistent with the
   `EFL Cup` / `EFL Trophy` labels already in the table, and the FA Cup
   has carried sponsor names (Emirates FA Cup) that must not enter the
   archive id.

   **Do NOT write curly-brace characters in comments inside
   `SOCCER_LEAGUE_LABELS`.** The deploy's "Soccer league label contract
   check" parses that literal with a body class excluding both braces; a
   single brace truncates the match and fails the step with
   "SOCCER_LEAGUE_LABELS constant not found" (run 31276384066).

3. **Run the label contract check locally before pushing.** Extract the
   base64 payload from the `Soccer league label contract check` step in
   `.github/workflows/deploy.yml` and run its two regexes against your
   edited `src/index.js`.
   **Artifact:** the printed `labels` count, `routed` count, and
   `uncovered` list. Both counts must increase by exactly 1 versus
   pre-edit, and `uncovered` must be `[]`.

4. **Client half (jubilant-bassoon).** Add to `SOCCER_LEAGUES`:
   `{ league: 'eng.fa', section: 'FA Cup', bundle: 'EFL', leagueLabel: 'FA Cup' }`
   — reuse an existing `BUNDLES` key, confirmed against the probed
   `broadcasts[]`; do not invent a bundle. `SOCCER_LEAGUES` is the
   card-CREATION mechanism (V2/FD only overlay scores onto cards that
   already exist), so the competition renders zero cards without it.

   Bump `SW_VERSION` in `src/legacy/field.js` AND `sw.js` (must match),
   then `node scripts/sync-source.mjs`. Never edit `index.html`'s script
   block directly.

   **Artifact:** `node smoke.js index.html` printing `0 failed`, and the
   executed output of `isDomesticLeagueInBreak('FA Cup', d)` for four
   dates spanning the competition — all must be `false`, with a
   positive control (`'Bundesliga'` on a date inside its winter break)
   returning `true`. Execute the function; do not reason about the
   substring match.

5. **Live verification.**
   - Relay: `probe_relay_route /v2/games?sport=facup&date=<a date with
     fixtures from Task 1>`.
     **Artifact:** HTTP 200 and `"league":"FA Cup"` in the body — the
     chosen label, not the raw key `facup`, and not any WC label.
   - Client: `html_probe` the live client URL and grep the deployed
     bundle for `eng.fa`.
     **Artifact:** the literal string `eng.fa` present. Do not assert on
     unminified spacing — the pipeline runs esbuild + strip-comments,
     which is why a `section: 'FA Cup'`-shaped grep would report NOT
     FOUND for a feature that shipped fine (this happened on run
     31278050296).

## Done condition

All four artifacts above produced: label check `uncovered=[]` with both
counts +1; smoke `0 failed`; relay returning `"league":"FA Cup"` for a
date with real fixtures; `eng.fa` present in the live client bundle.

If Task 1's unblock probe still reports `season.year: 2025`, the done
condition is instead: **no code changes, and an outbox note recording
the probe output and the date checked.** Do not wire a competition ESPN
is not serving.

## Scope boundary

Only the entries named above. Do not touch `adaptESPNWCSoccer`,
`canonicalizeWC26Sport`, any archive-write site, `BUNDLES`, or
`DOMESTIC_LEAGUE_BREAK_2026`.
