# Claude Code Command — the BSD join leaves clubs unmatched that its two fixture dates never contained

**Date:** 2026-10-28
**Repo:** field-relay-nba. Its consumer is `field-laboratory`
`docs/CC-CMD-2026-10-27-lineups-on-game-cards.md`, whose cards show "No lineup source for this game" for
every row this leaves unjoined. Rule 70: nothing here changes a response shape; it only joins more rows.
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (correctness) — a measured miss in a rule that was proven on two dates
**Status:** **DONE 2026-10-28.** Seven more dates measured (32 unmatched rows, 9 clubs), nine pairs added (`35146db`), deploy run
40624401500 success, live run 40625311405: 29 of 29 assertions, 292 of 294 soccer rows joined (27 of 27 proposals, 3 of 3
one-side-only), the five 2026-10-10 rows joined, 2 MLS rows unresolved because BSD has no event for them. Read independently from
D1: the same per-date counts. Session doc `outbox/cc-session-2026-10-28-bsd-join-aliases.md`. Seven dates, not a season.

```bash
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull; git log --oneline -5
```

---

## Why this exists, measured

`docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md` (DONE 2026-10-28) proved the join on two dates,
2026-08-29 and 2026-09-05: 43 of 43 and 41 of 41 soccer rows. Its 29 alias pairs were derived from those
two dates and only from them, as that CC-CMD's Task 3 required.

Then field-laboratory joined a THIRD date to capture event 5327's context (run 40620697737, 2026-10-28
02:24Z, `POST /admin/bsd-game-join {"date":"2026-10-10"}`):

```
pending 53, written 48, ambiguous 0, refusedKickoff 0, unjudgedKickoff 15, upstreamPages 9
unmatched 5: La Liga: Alavés v Atlético | La Liga: Barcelona v Getafe | Bundesliga: Augsburg v Bayern |
             Bundesliga: Paderborn v Stuttgart | Ligue 1: Monaco v Toulouse
```

48 of 53 is 90.6%: over the 90% floor the first CC-CMD set, with nothing to spare. All five misses are in
three leagues and all five are clubs the first two dates did not contain, which is what an alias table
derived from two dates predicts. Nothing is wrong with the rule: two candidates stay `ambiguous` and the
kickoff still only refuses. What is missing is names. **How many such clubs exist across a season of
dates is not known**, and measuring it is Task 2.

Each unjoined row is a card the laboratory draws as "No lineup source for this game". That is the honest
state, and it is the wrong one for a game BSD has an event for.

## Rulings and prior work this must not undo (BUILD-ON-A)

- `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`: **the kickoff never chooses.** A pair of names
  that fits two events is `ambiguous`, never the first. An alias is added because the two NAMES are the same
  club, shown by BSD's own payload, never because one kickoff time pointed at one event. Its stop condition 2
  (more than 40 added names is a design problem) applies again, to this CC-CMD's additions.
- `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md` and
  `docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md`: the odds writers use their own join, shape (a). Nothing
  here touches `findOddsForRow` or `odds-name-match.js`.
- `src/identity-resolver.js` is read by ten checks; their exit codes and counts before and after must be equal.
  A new pair that collides with an existing canonical key is a recorded collision, never a silent overwrite
  (the first CC-CMD's `Athletic` found exactly that).

## Scope (Rule 75)

**Touch:** `scripts/capture-bsd-game-join-fixture.mjs` (an `--out` flag), one new workflow and trigger file,
`scripts/measure-bsd-game-join.mjs` (new), `src/identity-resolver.js` (alias pairs only), `docs/`, `outbox/`.
**Do NOT touch:** `src/bsd-game-join.js` (the rule), `src/odds-name-match.js`, any route, any response shape, any
wrangler binding, the laboratory.

## TASK 0 — Probe block (run first; write nothing until it prints)

```bash
git log --oneline -5
node scripts/check-bsd-game-join.mjs --offline | tail -4            # 20/20 at HEAD, before any change
grep -c "" src/identity-resolver.js; grep -n "BSD-form\|bsd" src/identity-resolver.js | head   # where the 29 pairs live
sed -n 95,110p scripts/capture-bsd-game-join-fixture.mjs              # the fixed output name this task must not overwrite
ls outbox | grep fixture-bsd-game-join
for f in check-identity-table-collisions check-team-identity-collisions check-ambiguous-team-identity; do
  node scripts/$f.mjs >/dev/null 2>&1; echo "$f exit $?"; done        # the before-counts Task 3 must equal
```

Print, in the manifest: the alias count at HEAD (29 added pairs), the exit codes above, and the archive's
soccer rows per date per label for the dates chosen in Task 1 (the query is in Task 1).

## TASK 1 — Capture more dates, without overwriting the fixture the checks stand on

`capture-bsd-game-join-fixture.mjs` writes ONE fixed filename whatever `--dates` says, so a second run would
replace `outbox/fixture-bsd-game-join-2026-08-29-09-05.json`, which `check-bsd-game-join.mjs` and the mutation
harness read. Add `--out <path>` (default: the existing name, unchanged) and a self-test case that the default is
unchanged. A workflow `bsd-game-join-fixture-dates.yml`, triggered by a push to
`outbox/.trigger-bsd-game-join-fixture-dates` (first line: comma-separated dates) and by dispatch, runs it with
`--out outbox/fixture-bsd-game-join-more-dates.json`.

The dates are those with every league in the archive, chosen by this query on ARCHIVE_DB (run 2026-10-28):

```sql
SELECT date, SUM(sport='MLS'), SUM(sport='EPL'), SUM(sport='La Liga'), SUM(sport='Serie A'),
       SUM(sport='Bundesliga'), SUM(sport='Ligue 1') FROM regular_season_games
WHERE date BETWEEN '2026-09-01' AND '2026-10-27' AND id LIKE '%\_e%' ESCAPE '\' GROUP BY date
HAVING SUM(sport IN ('EPL','La Liga','Serie A','Bundesliga','Ligue 1')) >= 6 ORDER BY 8 DESC
```

Use: 2026-10-10, 2026-09-12, 2026-09-19, 2026-10-17, 2026-10-24, 2026-10-25, 2026-10-18. 2026-08-29 and 2026-09-05
stay out: they are the first fixture. The capture refuses a truncated day, as before.

## TASK 2 — Measure the miss before changing anything

`scripts/measure-bsd-game-join.mjs --fixture <file>`: run `joinBatch` per date over the fixture and print, per date
and per label, `joined N of M`; then list every row that is not joined with its reason and, beside it, the BSD
events within the kickoff window of the same league whose two names are NOT already claimed by a joined row. That
list is a reviewer's aid for proposing an alias; it is not a join rule and nothing in `src/` reads it.

Self-test with a synthetic corpus: a row whose names are fully known is joined and listed nowhere; a row with one
unknown club is listed with its one candidate; a row with two candidates is listed with both and marked
`ambiguous`; a row whose event is already claimed by another row is not offered. Each is a must-fail input for the
listing it names (Rule 90), and the script prints its coverage (dates, rows, events) with the result (Rule 91).

Print the result: unmatched rows over the seven dates, per label, and the distinct clubs behind them. **If the
distinct unmatched clubs number more than 40, STOP**: write the count and the cause to the outbox. That is a design
problem, not a long list.

## TASK 3 — Alias additions, from the measurement and nowhere else

For each unmatched club with exactly one BSD name proposed by Task 2, add the pair to `src/identity-resolver.js`
with a comment naming the row it came from. A club with two proposals, or none, is not added: it is listed in the
outbox as unresolved, with why. Run the three identity checks of Task 0 and
`node scripts/check-bsd-game-join.mjs --offline` before and after; the identity exits and counts must be equal,
the offline check must still be 20 of 20 (its two dates' rows must not change), and the added keys must be exactly
the added variants (the first CC-CMD's probe: every name in the corpus before and after, differing keys listed).

## TASK 4 — Deploy, join the same dates, read the coverage from the deployed relay

1. Push to main; read the deploy run to success (print its id).
2. For each of the seven dates and 2026-10-10 again, call the admin route from a runner (the lab's
   `capture-context-with-ids.yml` does this for one date, or dispatch it per date) and print `pending`, `written`,
   `unmatched` and the names.
3. The artifact is the per-date coverage read back from `/context/date/{date}`, with its denominator.

## DONE CONDITION — every line an artifact (Rule 89)

1. **The measurement, printed:** unmatched rows and distinct clubs over the seven dates, per label (Task 2), before
   any alias is added.
2. **Every added pair is shown to come from that measurement:** the outbox lists each pair with the row and the BSD
   event it was derived from; none comes from a kickoff alone.
3. **Existing behaviour unchanged:** the three identity checks exit as in Task 0, counts equal, and
   `check-bsd-game-join.mjs --offline` 20 of 20.
4. **After the deploy, on the deployed relay:** for each of the seven dates and 2026-10-10, `joined N of M` printed;
   the five rows named above are joined, or named as unresolved with the reason; no row of any date has an id that
   names the wrong teams (the first CC-CMD's own assertion, rerun over these dates).
5. **No duplicate claim:** no `bsd_event_id` appears on two rows of one date unless they are the same fixture under
   two id schemes, which is counted.
6. Deploy run success, id printed.

**What this does not prove, stated where it is read:** seven more dates, not a season; clubs promoted or loaned in
after 2026-10-28 are not in it; MLS and the five European labels only. The join's coverage on a date nobody has
captured is unknown until someone captures it.

## TASK 5 — Outbox manifest (last)

`outbox/cc-session-<date>-bsd-join-aliases.md` (>= 1500 characters): commit hashes, the deploy run id, the
measurement and the coverage artifacts, the alias count (added, unresolved), the identity-check output before and
after, and any genuine residual (an upstream failure only). Mark this CC-CMD DONE with the run ids, and update
the laboratory's consumer CC-CMD status line with the new per-date coverage.
