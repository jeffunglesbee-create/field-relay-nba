# Claude Code Command — 210 odds_history rows are in American odds, and the sync converts them as decimal

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
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
