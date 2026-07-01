# Claude Code Command — team_form CONTEXT_SOURCE (close the recent-form gap)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-team-form-context-source-2026-06-30.md.

## CONTEXT

`team_form` was fully designed and marked "v3 FINAL" on 2026-06-27 (Drive
1S---UbRREfhHGFPSvMtwUEtvFX8Mfaig) — verified schema, verified binding,
exact builder code, exact registration entry, checkable done conditions.
It was never implemented. Confirmed by grepping live `src/context-assembler.js`
and `src/index.js`: zero occurrences of `team_form` or `buildTeamFormContext`
anywhere. Of the 12 real `CONTEXT_SOURCES` currently registered, only ONE
(`soccer_season_form`, MLS-only) covers "recent form" at all — every other
sport in the registry has no recent-form context whatsoever.

**Fix 1 (D1 data correction) already executed chat-side, 2026-06-30** — do
not repeat it: `UPDATE regular_season_games SET home = 'Bosnia and
Herzegovina' WHERE home = 'Bosnia-Herz' AND sport = 'FIFA World Cup 2026'`
ran and is verified (1 row changed, read-back confirms corrected name).
This CC-CMD covers Fix 2 (code) only.

**Fix 3 (ESPN historical backfill for USA WC group games) is explicitly
optional per the spec** and is a chat-side data operation if pursued
later (CC cannot reach `site.api.espn.com` or run live D1 inserts against
production — same egress constraint as every other CC-CMD this session).
Do not attempt it here.

**Freshness note:** the spec's row counts are from June 27 and are now
stale — live counts as of tonight (2026-06-30): MLB 180, WNBA 54, MLS 289,
EPL 26, AFL 16, FIFA World Cup 2026 24, La Liga 10, CFL 2, Ligue 1 2 (plus
IPL 2, PGA Tour 2, golf 13 — not relevant to this source). None of this
changes the spec's code — row counts don't affect the builder or
registration, only confirms the table is live and growing. Still zero
NHL/NBA rows (both out of season) — matches the spec's exclusion.

## PRE-BUILD PROBE (read every symbol below from HEAD before writing anything — Rule 87)

```bash
grep -n "CONTEXT_SOURCES = \[" src/context-assembler.js
sed -n '858,960p' src/context-assembler.js   # current registry, insertion point
grep -n "buildBSDHistoryContext" src/context-assembler.js   # exact insertion anchor per spec
grep -n "CANONICAL" src/identity-resolver.js | head -5
grep -n "Bosnia" src/identity-resolver.js   # confirm no existing entry (spec says none)
tail -20 src/context-assembler.js   # confirm current export block shape before adding buildTeamFormContext
```

Confirm the exact `export { ... }` block shape in `context-assembler.js`
before editing it — the spec's export line must match the file's actual
current style, not be assumed.

## TASK 1 — identity-resolver.js: add Bosnia CANONICAL entries

Inside the `pairs` array, WC section, add exactly (per spec, verified
against live `resolveTeamKey()`/`CANONICAL` pattern in the probe step):

```javascript
['Bosnia and Herzegovina', 'Bosnia and Herzegovina'],
['Bosnia-Herzegovina',     'Bosnia and Herzegovina'],
['Bosnia & Herzegovina',   'Bosnia and Herzegovina'],
['Bosnia-Herz',            'Bosnia and Herzegovina'],
```

This fixes `teamNameMatch()` for the BSD/Odds join — separate from the D1
name fix already applied chat-side, and still needed even though the D1
row itself is now corrected.

## TASK 2 — context-assembler.js: builder + sport map + registration + export

Insert after `buildBSDHistoryContext`, exactly as specced (read the full
builder in the pre-build probe's grep for `buildBSDHistoryContext` first
to confirm the real insertion point and surrounding code style before
pasting):

```javascript
const _TEAM_FORM_SPORT_MAP = {
  mlb:        'MLB',        wnba:       'WNBA',
  wc26:       'FIFA World Cup 2026',
  afl:        'AFL',        cfl:        'CFL',
  epl:        'EPL',        mls:        'MLS',
  ucl:        'UCL',        laliga:     'La Liga',
  seriea:     'Serie A',    bundesliga: 'Bundesliga',
  ligue1:     'Ligue 1',    nhl:        'NHL',
  nba:        'NBA',
};

async function buildTeamFormContext(env, game) {
  if (!env.ARCHIVE_DB) return '';

  const dbSport = _TEAM_FORM_SPORT_MAP[game.sport];
  if (!dbSport) return '';

  const home = game.home?.name || game.home;
  const away = game.away?.name || game.away;
  if (!home || !away) return '';

  const N = 5;

  try {
    const [hResult, aResult] = await Promise.all([
      env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score
         FROM regular_season_games
         WHERE sport = ? AND (home = ? OR away = ?)
           AND home_score IS NOT NULL AND away_score IS NOT NULL
         ORDER BY date DESC LIMIT ?`
      ).bind(dbSport, home, home, N).all(),

      env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score
         FROM regular_season_games
         WHERE sport = ? AND (home = ? OR away = ?)
           AND home_score IS NOT NULL AND away_score IS NOT NULL
         ORDER BY date DESC LIMIT ?`
      ).bind(dbSport, away, away, N).all()
    ]);

    const fmt = (teamName, rows) => {
      if (!rows?.length) return null;
      let gf = 0, ga = 0, w = 0;
      const segments = rows.map(r => {
        const isHome   = r.home === teamName;
        const scored   = isHome ? r.home_score : r.away_score;
        const conceded = isHome ? r.away_score : r.home_score;
        const opp      = isHome ? r.away       : r.home;
        const res      = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
        gf += scored; ga += conceded;
        if (res === 'W') w++;
        return `${res} ${scored}-${conceded} vs ${opp}`;
      });
      const n = rows.length;
      return `${teamName} (L${n}): ${segments.join(' · ')} | ` +
             `${w}W ${(gf / n).toFixed(1)} scored ${(ga / n).toFixed(1)} conceded`;
    };

    const lines = [
      fmt(home, hResult.results),
      fmt(away, aResult.results)
    ].filter(Boolean);

    return lines.length ? `[TEAM FORM]\n${lines.join('\n')}` : '';

  } catch (_) {
    return '';
  }
}
```

Register in `CONTEXT_SOURCES` (insert in priority order — priority 9 sits
after `bsd_history`/`golf_leaderboard`, priority 8/7 items):

```javascript
{
  name: 'team_form',
  builder: buildTeamFormContext,
  priority: 9,
  budget: 200,
  sports: [
    'mlb', 'wnba', 'wc26', 'afl', 'cfl',
    'epl', 'mls', 'ucl', 'laliga', 'seriea', 'bundesliga', 'ligue1'
  ]
  // Excluded: pga (round-based rows, not matchup format), atp, wta
  // nhl/nba: add when season starts and rows exist — confirmed still
  // zero rows for both as of 2026-06-30, exclusion still correct
},
```

Add `buildTeamFormContext` to the file's `export { ... }` block, matching
whatever exact style the pre-build probe found (don't assume the spec's
literal export line is still accurate to the file's current shape).

## TASK 3 — Verification

```bash
node --check src/context-assembler.js
node --check src/index.js
node --check src/identity-resolver.js
```

Done condition (checkable in this session): all three `node --check`
commands exit clean, CI green, deploy completed.

**Chat-side follow-up (not part of this CC-CMD's done condition):** live
confirmation that `/v2/games?sport=mlb` and `/v2/games?sport=wc26` return
200, and a direct D1/relay probe confirming a `[TEAM FORM]` block appears
for a real upcoming WC26 or MLB game — same verification standard used
for every other CC-CMD tonight, run from chat since CC cannot reach
`*.workers.dev`.

## TASK 4 — Outbox manifest (last task)

Write `outbox/cc-team-form-context-source-2026-06-30.md` covering: what
the probe confirmed about the real insertion points and export block
shape (vs. the spec's assumptions), the exact diff, CI/deploy status, and
explicit confirmation Fix 1 (D1 data) was NOT touched by this CC-CMD
since it was already handled chat-side.

## COMPLIANCE (carried from the original spec, still applies)

- Rule 47 / ADR-002: no drama values stored or emitted — `team_form` is
  pure factual W/L/score history, nothing computed or composited.
- Rule 5: try/catch wraps the entire async body, any failure → `''`.
- Rule 63: builder must be registered and called — no dead code shipped.
