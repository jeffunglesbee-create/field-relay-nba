# CC session — the brace counter was reading prose as syntax

**Date:** 2026-09-13 UTC · **Repo:** field-relay-nba · `main` (`c176266`)
**CC-CMD CLOSED:** `2026-09-13-route-scan-brace-balance-defeated` — filed and
closed the same day, as the successor to
`2026-09-12-route-provenance-truncation-invisible`.

---

## Task 0 printed line numbers, which is why the answer is not the hypothesis

The CC-CMD's leading hypothesis was string literals, and said explicitly it was
**not claimed** until a depth trace printed. The trace found **seven** lines —
six of them **comments**, which the hypothesis had not named:

```
11978  //   { ok, date, games_found, ...             counted +1, real 0
11979  //     quota_remaining, stopped?, reason? }    counted -1, real 0
12879  if (kvVal && kvVal[0] === '{') {              counted +2, real +1
12954  // ... americanfootball_{cfl,ncaaf,nfl,        counted +1, real 0
12955  // ufl}, aussierules_afl and cricket_ipl       counted -1, real 0
13285  // Body: { triggered_by, date, teams: [{       counted +2, real 0
13286  // pR32, ... pChamp}] }. INSERT OR REPLACE     counted -2, real 0
```

Residual depth **1**. The block never balanced, the scan ran to the window edge,
and `/archive/`'s declared sources became whatever fell inside 1500 lines.

## The window was never too small

Stripped of comments and strings, `/archive/` balances at **line 13366 — 1470
lines, inside the existing 1500 window.** `/cfl/` is at 13397, **31 lines past
the true end.**

So the cfl hosts that started this whole chain were never `/archive/`'s, and
neither was the "fix" of removing them. The parent CC-CMD's instinct — that both
values were artifacts of where a boundary landed — was exactly right, and the
boundary was the counter, not the window.

## The result, at the unchanged window

```
/archive/  BEFORE  s: "...the-odds-api + d1:ARCHIVE_DB + do:AMBIENT_DO + ...", t: 1
           AFTER   s: "...the-odds-api + d1:ARCHIVE_DB + field-claude-proxy + kv:FIELD_JOURNALISM"
```

`t: 1` gone, and `do:AMBIENT_DO` gone — that was the `/live/*` block bleeding in
past the true end.

Truncated: **2 of 225 → 1 of 225.** The survivor `/mcp` is **genuine** — 0
offending lines, raw depth 4 == real depth 4. A real block longer than the
window, correctly flagged. Left flagged rather than papered over, which is what
the parent CC-CMD's flag exists for.

## What is deliberately not handled

**Regex literals.** Telling a regex from a division needs the preceding token,
which is a parser, and the CC-CMD said not to write one. It is safe in practice
(regex braces are quantifiers that cancel — `/^\d{4}-\d{2}-\d{2}$/` at `:11982`
is four that do) and safe in principle: an unbalanced one leaves residual depth,
which fails to balance, which sets `truncated: true`. **It degrades to the
flagged partial read it already had, never to a silent wrong answer.** That
property is why the bound is acceptable, and it is written at the code.

## Two harness defects, both mine, both caught before the result was trusted

1. **B5's anchor lost its backslashes** passing through a shell heredoc. The
   harness reported `ANCHOR / NOTHING WAS MUTATED` instead of a verdict — which
   is precisely what that guard exists for. Rebuilt from the file's real bytes
   via `json.dumps` rather than hand-escaped.
2. **The escaped-quote case did not discriminate.** Two attempts netted the same
   with and without the escape skip, because dropping it exposes one brace and a
   second string then swallows the next. Found a line that does differ by
   **running both variants side by side** instead of reasoning about it a third
   time.

The second one matters more than it looks: the case was *passing*, and it would
have sat in the suite asserting nothing. Only the mutation said so.

## Final

19 enumerated cases including all seven real offenders verbatim, plus the
end-to-end claim that `/archive/` parses whole and does not reach `/cfl/`. Five
mutations, all caught. Both wired into `deploy.yml`.
