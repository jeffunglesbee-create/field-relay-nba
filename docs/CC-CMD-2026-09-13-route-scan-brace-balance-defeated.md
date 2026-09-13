# CC-CMD-2026-09-13 — `/archive/` never balances, and it is not the window

**STATUS: CLOSED 2026-09-13** (`c176266`), same day it was filed. All tasks done.

**Task 0 found seven lines, not a hypothesis.** Six comments and one string
literal, netting a residual depth of 1:

```
11978  //   { ok, date, games_found, ...             counted +1, real 0
11979  //     quota_remaining, stopped?, reason? }    counted -1, real 0
12879  if (kvVal && kvVal[0] === '{') {              counted +2, real +1
12954  // ... americanfootball_{cfl,ncaaf,nfl,        counted +1, real 0
12955  // ufl}, aussierules_afl and cricket_ipl       counted -1, real 0
13285  // Body: { triggered_by, date, teams: [{       counted +2, real 0
13286  // pR32, ... pChamp}] }. INSERT OR REPLACE     counted -2, real 0
```

**The window was never too small.** Stripped, `/archive/` balances at line
13366 — 1470 lines, inside the existing 1500. `/cfl/` is at 13397, **31 lines
past the true end**, so the cfl hosts the parent CC-CMD chased were never
`/archive/`'s at all.

**Task 2 done condition, at the unchanged window:** `t: 1` gone and
`do:AMBIENT_DO` gone — the `/live/*` block bleeding in past the true end. Four
sources. Truncated routes 2 of 225 → 1 of 225, and the survivor `/mcp` is
**genuine**: 0 offending lines, raw depth 4 == real depth 4, a real block longer
than the window, correctly flagged rather than papered over.

**Regex literals are not handled**, deliberately and with a bound — see the note
in `route-scan.mjs`. An unbalanced one degrades to the flagged partial read it
already had, never to a silent wrong answer.

Session doc: `outbox/cc-session-2026-09-13-brace-balance-defeated.md`.

---

Second CC-CMD from `CC-CMD-2026-09-12-route-provenance-truncation-invisible`,
filed per Rule 87.4. That one made a partial read say so; this one is about why
the parse is partial.

## Task 2 of the parent is ANSWERED — raising the window is strictly worse

Measured 2026-09-13, `src/index.js` at 20,730 lines:

| `WINDOW` | routes truncated (of 225) |
|---|---|
| 1500 (current) | 2 |
| 3000 | 1 |
| 6000 | 1 |
| 12000 | **0** |

Zero at 12000 looks like the fix. It is not. That is more than half the file,
and what `/archive/` then *claims* is:

```
api-web.nhle.com + api.balldontlie.io + api.datamuse.com + api.football-data.org
+ api.github.com + api.prod.whoop.com + api.sportradar.com + api.squiggle.com.au
+ apim.laliga.com + app.atptour.com + baseballsavant.mlb.com + cdn.nba.com
+ cflscoreboard.cfl.ca + cloudflare-dns.com + content.dropboxapi.com + ...
+ fantasy.premierleague.com + wapp.bapi.bundesliga.com + wikimedia.org
+ www.atptour.com + www.bundesliga.com + www.laliga.com
```

**50 hosts. Essentially every upstream the worker contacts.** `/archive/*`
fetches approximately five of them. And the entry loses its `t: 1`, because the
scan "balanced" — so the manifest goes from *under-reporting and flagged* to
*wildly over-reporting and confident*. The stamp is served on live responses.

The parent CC-CMD predicted this — *"it changes which routes are wrong without
making any of them say so"* — and it is worse than predicted: it also makes them
much wronger. **WONTDO, on evidence.**

## The real finding

A block that requires 12,000 lines to balance is not a 12,000-line block. The
brace counter is being defeated somewhere inside `/archive/`'s dispatch and
accumulating an imbalance it only works off by swallowing most of the file.

`bodyOf` counts every `{` and `}` in every line:

```js
for (const ch of line) {
  if (ch === '{') { depth++; started = true; }
  else if (ch === '}') depth--;
}
```

**Leading hypothesis, NOT established:** braces inside string literals, regex
literals or template literals are counted as structure. A single
`` `${a}` `` or `/\{/` or `'}'` in that region shifts `depth` permanently.

## Tasks

0. **Probe — find where the imbalance enters.** Instrument `bodyOf` to record
   `depth` per line across `/archive/`'s window and print the lines where it
   crosses back above zero after the block should have closed. **The artifact is
   a committed list of line numbers and their text** — not "strings probably".
   If the hypothesis is wrong, that list says so and this CC-CMD is rewritten
   against what it actually shows.

1. **Fix what Task 0 names.** If it is literals, the counter needs to skip
   them. Do not write a JavaScript parser; skipping quoted spans, template
   spans and regex literals is enough and is bounded. If it is something else,
   stop and re-file rather than reaching for the same fix.

2. **Re-measure the table above.** The done condition is not "zero truncated" —
   it is that `/archive/`'s declared sources shrink to the ones it actually
   fetches, with `t: 1` gone because the parse is genuinely complete. **Commit
   the before/after source lists.** A zero reached by swallowing the file is the
   failure this CC-CMD exists to prevent.

3. **Mutation (Rule 90).** A literal containing an unmatched brace, placed
   inside a short handler, must not change that route's parsed end. The check
   fails if it does.

4. **Done condition.** `check-route-provenance.mjs` green, `/archive/` carrying
   a source list under ~8 hosts with no `t: 1`, and the committed diff of its
   manifest entry.

5. **Outbox manifest** per Rule 67.

## Not claimed

That literals are the cause. Task 0 exists because the parent CC-CMD's own
lesson was that a boundary artifact reads exactly like a fact, and "it must be
the strings" is a boundary artifact of my own reading until the depth trace
prints.
