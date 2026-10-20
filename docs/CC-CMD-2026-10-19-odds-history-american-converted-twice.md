# Claude Code Command — 210 odds_history rows are in American odds, and the sync converts them as decimal

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** DONE 2026-10-20. Dispatched by the owner with "go with Claude's best recommendations"; TASK 1 (a) and TASK 2 (a). See Results.
**Filed by:** CC, from the TASK 0 census of
`docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md` (Rule 87.4: found there, out of
that document's scope).

---

## What was measured (2026-10-19)

Method: `node scripts/census-odds-pairs.mjs` over
`outbox/fixture-odds-pairs-2026-10-19.json`, which holds every odds_history row
created since 2026-09-16 10:42Z, joined to its archive row (776 of 980 rows). Its
`meta` holds the SELECT and the 7 aggregates it was checked against in D1.

**Two writers, two units, one reader.**

| writer | request | rows | prices in odds_history |
|---|---|---|---|
| `scripts/targeted-odds-fill.mjs:267` | `oddsFormat=american` | 210 (`_targeted`, snapshot_type `open`) | all 210 American, e.g. `-345` / `275` |
| `.github/scripts/odds-backfill.js:195` | `oddsFormat=decimal` | 566 (snapshot_type `close`) | all 566 decimal |

`syncOddsToGameTables` (`.github/scripts/odds-backfill.js`) runs
`decimalToAmerican` on every row it reads. On an American price that gives:
- `275` → `+27400`, since `(275 − 1) × 100`;
- `-345` → `null`, since a "decimal" price at or below 1 is refused.

**Damage in the game tables,** among the 210 targeted rows:
- 229 sides on 206 rows match the double-conversion signature exactly (census
  section UNITS);
- 159 rows have `opening_odds.moneyline.home` NULL;
- 178 rows have an away moneyline of magnitude 10000 or more.

By sport: CFB 150, EFL Cup 46, NFL 13, La Liga 1, across 8 dates. Example:
`CFB_2026-08-29_emichigan_sacramentost` stores Sacramento St at `+27400`, where
odds_history holds `275`.

**Not measured:** which readers consumed these blobs, and whether any client
render showed `+27400`.

## TASK 0 — premises, one command each (Rule 100)

1. **Every odds_history row's unit, by writer, over the whole table** (980 rows,
   not 776). The SELECT counts rows with `|home_ml| >= 100 OR home_ml < 1`, grouped
   by `snapshot_type` and by id suffix.
2. **Every reader of odds_history prices,** and the unit each one assumes:
   `grep -rn "home_ml\|away_ml" src scripts .github/scripts`. At minimum the sync and
   `scripts/probe-captured-at-provenance.mjs`.
3. **Every reader of the 206 game rows' moneylines,** in both repos: grep for
   `opening_odds` and `closing_odds` readers.

## TASK 1 — one unit in odds_history (OWNER DECISION)

- (a) the targeted fill asks for `oddsFormat=decimal`, as the backfill does, so
  odds_history is decimal everywhere;
- (b) a units column on odds_history, and the sync converts by it.

Proof: a fixture from a real targeted row (`275` must sync to `+275`), red before
and green after, plus a Rule 90 mutation.

## TASK 2 — repair the 206 game rows (OWNER DECISION)

- (a) re-derive each blob from its odds_history row with the right unit, guarded
  on the blob still holding the double-converted value;
- (b) NULL the blobs, with a `change_log` row each.

No D1 write before the ruling.

## Done condition (Rule 89 artifacts)

1. TASK 0's three outputs are committed, each with its denominator.
2. TASK 1's fixture is red before and green after, with its mutation, in a
   committed log.
3. After TASK 2, a D1 SELECT shows 0 rows matching the UNITS signature. Committed.
4. One green deploy-path run.

## FORBIDDEN

- No D1 write before the owner rules on TASK 2.
- No Odds API spend.

---

## OWNER DECISIONS, 2026-10-20

The owner dispatched this document with "Go with Claude's best
recommendations." These are the choices made under that delegation, with the
reason for each.

- **TASK 1: (a), plus the existing rows converted.** The fill asks for
  `oddsFormat=decimal`, and the 211 American rows are converted in place.
  - One unit leaves nothing for any reader to consult. A units column (b)
    would make every reader of odds_history, today and later, check it.
  - The rows are converted, not deleted. Re-fetching costs credits, and the
    conversion is exact: the sync gives the American price back on 469 of 469
    real sides.
- **TASK 2: (a), re-derive.** Each blob's moneyline is recovered exactly from
  its own row. NULLing (b) would have dropped 422 prices that are known.

## Results (2026-10-20, CC)

**TASK 0.**
- **0.1, every odds_history row's unit, the whole table (954 rows):**
  - 743 `_close` rows are decimal. The two that look American are decimal
    in-play extremes (301/1 and 1/101/56).
  - 211 `_targeted` rows are American. This document counted 210 because its
    census began at 10:42Z on 2026-09-16; the IPL row was written at 01:24Z.
- **The damage was larger than measured above:** 211 games, 422 blobs.
  - The sync wrote one blob into both columns of every game the fill priced,
    and each blob is the double conversion of its own row.
  - 47 of them carry a draw converted twice as well.
  - The earlier "206 rows, 229 sides" skipped every null side.
- **0.2 and 0.3, every reader:** `outbox/odds-american-readers-2026-10-20.md`.
  A 38-agent census across four repos found 69 readers; the 34 with any
  possible effect were re-checked (27 confirmed, 7 refuted).
  - Every blob reader assumes American integers; every odds_history reader
    assumes decimal.
  - D1 holds 0 briefs and 0 analytics_output rows built from these blobs.
  - No committed artifact in any repo holds a damaged value.
  - What showed the damage was live rendering: the client debrief line
    ("E Michigan null · Sacramento St +27400"), the playground desk, the
    lab's desk and scoreboard, and any analytics run for those dates.

**TASK 1.**
- **The fill** asks for decimal (`01dde259`). REQUEST_SHAPE is unchanged: the
  format changes how a price is written, not which events exist, so no
  dead-pair verdict reopens and no credit is re-spent.
- **`scripts/check-odds-history-units.mjs`** runs in guards and in the deploy
  gate (`01dde259`, reworked in `c4d54e34` after the review):
  - every vendor odds request in the runtime code asks for decimal, unless its
    file is one of six reviewed American readers that write no odds_history
    row;
  - the conversion comes back exact through the sync's own decimalToAmerican
    on 469 of 469 real sides.
- **Red before:** the base fill fails it.
- **Mutations:** U1-U10, 86 of 86 caught.

**TASK 2.**
- **What was applied:** `scripts/repair-odds-american-units.mjs --apply-sql`
  at `32a51a04`, sha256 `600afa83…`. It is six set-based statements in one
  transaction.
- **How it was proven first:** the self-test ran it against an oracle of
  1,266 literal statements on all 211 real rows. Every blob came out
  byte-equal, every row bit-equal, and the change_log rows identical.
  Set-based mutations: 7 of 7 caught.
- **Applied** 2026-10-20 after the code was on main.
  - 6 of 6 statements succeeded, 211 changes each.
  - change_log ids 22971-23603: 633 rows.
- **Verify read:** 11 of 11 fields as expected.
  - 211 of 211 rows are decimal.
  - 422 of 422 blobs equal what the sync's conversion makes of their row.
- **Done condition 3:** 0 of 211 games carry a price of +10000 or more or a
  null side; before the repair, 188 had a null side.

**Residual, filed (Rule 87.4):** a browser that cached one of these games'
debrief context before the repair keeps rendering the damaged line. That lasts
until the entry is 7 days old and a new service worker activates. The client
cache reads with no age check; filed as jubilant-bassoon
`docs/CC-CMD-2026-10-20-debrief-cache-outlives-archive-repair.md` (`1fc8f319`).

Proof: `outbox/odds-american-units-2026-10-20.log`. Session doc:
`outbox/cc-session-2026-10-20-american-odds-units.md`.

