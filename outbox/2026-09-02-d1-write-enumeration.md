# Task 1 — every D1 write path, enumerated

`scripts/d1-write-sites.mjs`, committed so the count cannot rot.

```
285 prepare() site(s) across 32 source file(s)
  writes      87
  reads       198
  UNREADABLE  0

writes by binding:          writes by verb:
   74  env.ARCHIVE_DB          38  INSERT
    7  db                      24  UPDATE
    3  env.WC2026_DB           13  CREATE
    2  env.DB                   7  ALTER
    1  this.env.ARCHIVE_DB      5  DELETE
```

The CC-CMD said "191 `prepare` calls is not an enumeration". The real figure is
**285 sites, 87 of them writes** — the 191 was a single file.

`workers/` and `containers/` exist and contain **no** `.prepare(` call, so `src/`
is the whole scope. Checked rather than assumed.

## Why this needed a parser and not a grep

The SQL is written as multi-line template literals, so `grep 'INSERT INTO'`
finds the line a word is on and nothing about which binding it runs against.
The enumerator walks each `.prepare(` from its opening paren, balancing parens
and tracking string state — `COUNT(*)`, `COALESCE(a, b)` and `VALUES (?, ?)` all
end a lazy regex match early.

**The first run reported one UNREADABLE site**, `src/index.js:5477`. Its argument
opens with a twelve-line comment between `prepare(` and the backtick, every line
after the first indented, so an anchored `^//` strip removed one line and left
the rest. It is a `CREATE TRIGGER` — a write that would have been silently
missing from the enumeration. The strip now loops until nothing moves, and the
shape has its own self-test. 16/16.

## The finding: the dynamic INSERT a grep can never see

Six write sites interpolate their target:

```
src/index.js:11199        UPDATE ${table} SET drama_peak = ?, drama_arc = ? ...
src/index.js:11584        UPDATE ${tbl} SET home = COALESCE(home, ?) ...
src/index.js:11965        UPDATE ${oddsTable} SET closing_odds = ? WHERE id = ?
src/index.js:17557        INSERT OR IGNORE INTO ${table} (${cols}) VALUES (${placeholders})
src/sync-reconciler.js:139 UPDATE ${target} SET ${setClause} WHERE id = ?
src/sync-reconciler.js:220 UPDATE change_log SET consumed = 1 WHERE id IN (...)
```

`17557` is the one that matters. It is a fully dynamic INSERT — table AND columns
— reached from `POST /savant/sync`. **No search for `INSERT INTO
regular_season_games` could ever have found it**, and the prior claim that
exactly one code path inserts into that table was true of the literal string
rather than of the behaviour.

It is not the second writer, and that is now established rather than assumed:
the route refuses any table absent from `_SYNC_TABLE_SCHEMAS`, and that
allowlist holds exactly one entry, `pitcher_expected_stats`. The check is a
guard on scope, not only on injection, and the route says so in its own comment.

## What writes `regular_season_games`

Eight sites name it directly:

| line | verb |
|---|---|
| 5757, 5774 | ALTER (schema) |
| 5809, 10870, 11310, 11465, 11474 | UPDATE |
| **11801** | **INSERT** — the only one |

`11801` is the `/archive/game` route. `sync-reconciler.js:139`'s
`UPDATE ${target}` could reach the table but cannot create a row.

**So no code path in this repository can INSERT a dash-scheme row into
`regular_season_games`.** The enumeration is now complete enough to say that as
a measurement rather than as the result of not finding something.

## This changes what Task 2 can achieve, and the CC-CMD should say so

The provenance instrumentation was specified to name the second writer. If the
writer is outside this repository — which the enumeration now indicates — then
instrumenting all 87 sites produces the control entry and never a `dash` entry.
That is exactly the row the verdict already calls `NOT OBSERVED: extend the
window; do not close`, and it would stay that way forever regardless of window
length.

The instrumentation is still worth shipping, but its honest claim is narrower
than the CC-CMD states: **it proves the write is not ours.** Naming an external
writer needs a different instrument — Cloudflare's own D1 audit, or a column on
the row recording its origin at insert time, neither of which this route can
provide for a writer that does not call it.

Recorded here rather than discovered at the end of Task 2, when 87 edits would
already be committed.
