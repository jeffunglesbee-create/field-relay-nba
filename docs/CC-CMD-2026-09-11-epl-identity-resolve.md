# Claude Code Command — Resolve EPL team names before the forecaster

**Date:** 2026-09-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug fix)
**Status:** PARTIAL, 2026-11-22. Defect 1 was resolved by another commit. Defect 2 is built, with the rule corrected (below), and merged in `966fe0c8`. It is NOT YET DEPLOYED: the relay's deploy has failed since another session's `79d9dfc8` (an absence-collapse ratchet, `scripts/bsd-next-goal-probe.mjs`, 57 against a baseline of 56; run 45044427433), and the last green deploy was 2026-11-21. Its reading on the live route is STAGED behind that deploy. Task 2 is built in field-laboratory. Task 0's live matchday payloads are not met (below). Carried forward on the owner's word, 2026-11-22 ("Carry forward"); the status line did not exist before.
**Run BEFORE** `field-laboratory` `CC-CMD-2026-09-11-epl-forecaster-phase1.md`.
A bad team join fails silently and the forecaster would be built on it.

Scope is deliberately narrow: two defects, both measured. Do not extend.

## MEASURED 2026-09-11 via `/identity/mismatches?date=2026-09-12&sports=EPL`

```json
{ "probed": 1, "matched": 0, "unmatched": 1, "key_substituted": 1,
  "EPL": { "odds_events": 20, "d1_missing": 1,
    "key_substituted": [{ "name": "Ipswich", "key": "ipswichtown" }],
    "unmatched":       [{ "d1_home": "C Palace", "d1_away": "Ipswich",
                          "d1_key": "cpalace|ipswichtown" }] } }
```

The odds side is healthy — `odds_sample` shows `hullcity`, `coventrycity`,
`ipswichtown` all resolving. The 2026-08-21 promoted-club work holds.

## DEFECT 1 — `C Palace` has no CANONICAL entry

D1 holds `"C Palace"`, which strips to `cpalace`. The Odds API sends
`"Crystal Palace"` → `crystalpalace`. They never match.

Identical shape to the note already at `identity-resolver.js:376`: "D1 holds only
'Coventry', so a feed sending the full name cannot match." Different club, same
cause, and that note was written three weeks ago.

**Fix:** add the alias. Then check D1 for OTHER abbreviated home/away spellings
in EPL rows rather than fixing only the one that surfaced today — `C Palace`
appeared because that fixture happened to be probed, not because it is the only
one. Report every abbreviated spelling found; add aliases for all of them.

## DEFECT 2 — `key_substituted` conflates two different things

Its comment says it "counts rows whose resolved team key is not derived from
their own display name — a wrong row, not a naming difference."

But `Ipswich → ipswichtown` was flagged, and that is the resolver WORKING: a
known alias resolving to its canonical form. Legitimate alias resolution and a
genuinely wrong row both produce "key not derived from display name", so the
metric cannot tell them apart.

**Fix:** distinguish them. A key reached via a known `CANONICAL` entry is
RESOLVED. A key reached any other way is SUBSTITUTED. Report both counts
separately; never collapse them into one number.

This is Rule 99 (`jubilant-bassoon/STANDARDS.md:4906`) applied to a diagnostic:
if an alarm fires on correct behaviour, it trains people to ignore it.

## TASK 0 — PROBE

1. Re-run `/identity/mismatches` for at least three EPL matchdays and record real
   payloads. Note that `probed` is the denominator, NOT `odds_events` — a chat
   session misread `matched: 0` against 20 events when the denominator was 1.
2. Query D1 for distinct EPL home/away display names and list every spelling
   that does not resolve through `resolveTeamKey()`.

## TASK 1 — Fix both defects

As above. Do not restructure the resolver; add entries and split one metric.

## TASK 2 — Seasonal check

Promotion and relegation change three clubs every summer and nothing currently
verifies the alias table against the live league. Add a check comparing
`/espn-standings/soccer/eng.1/standings` (20 clubs) against resolver coverage,
and report clubs present in the league but absent from any alias path.

Note the inverse case too: the CLIENT's `FPL_SHORT_NAME_MAP`
(`jubilant-bassoon field.js:19869`) still lists `Wolves`, who are not in the
2026-27 table. Report it; do not fix it here — it is a different repo.

## DONE CONDITION

- `/identity/mismatches` re-run for three matchdays, payloads pasted verbatim.
- `C Palace` resolves; every other abbreviated D1 spelling found is listed and
  fixed.
- RESOLVED and SUBSTITUTED reported as separate counts.
- Seasonal check reports 20 of 20 clubs covered, or names the gaps.

## TASK 3 — Outbox manifest (last task)

`outbox/cc-session-2026-09-11-epl-identity-resolve.md` with the Task 0 payloads,
every spelling fixed, the two counts, and the seasonal check output.

---

## CARRIED FORWARD 2026-11-22

Read first, so nothing is built twice (BUILD-ON-A): this CC-CMD was filed 2026-09-14, never executed, and the forecaster that waited on it retracted the wait ("superseded and never ran", field-laboratory `docs/CC-CMD-2026-09-11-epl-forecaster-phase1.md`). The forecaster is the laboratory's; its team identity is `src/odds-name-match.js`.

### Defect 1: resolved, by a different commit

`C Palace` and `Crystal Palace` both resolve to `cpalace`. The alias came in `7191291f` (2026-10-27, "29 BSD club names reach the archive's names through resolveTeamKey"), not from this CC-CMD. Checked 2026-11-22 against the relay at `bd4a6c7`: a read-only SELECT of `field-archive` gave 34 distinct EPL home/away names over 135 rows; run through `resolveTeamKey` they fall into 23 keys, and every club's spellings meet (`C Palace | Crystal Palace`, `Nottm Forest | Nottingham Forest`, `Man Utd | Man United | Manchester United`, `Sunderland | Sunderland AFC`, ...). No D1 spelling is left unresolved. The 23 are the 20 clubs of the 2026-27 table plus the three relegated in May (West Ham United, Wolverhampton Wanderers, Burnley), whose rows end 2026-05-24.

A lead from the first status check, `Nott Forest`, was a spelling I chose and did not read from D1; D1 holds `Nottm Forest`, which resolves. Refuted by the query above.

### Defect 2: the CC-CMD's rule does not work, so it was not built as written

The rule: "A key reached via a known `CANONICAL` entry is RESOLVED. A key reached any other way is SUBSTITUTED." Measured 2026-11-22 against `src/identity-resolver.js`: every wrong-sport case this metric exists to find is reached through `CANONICAL` (CFB `Colorado` -> `coloradorapids`, `Liberty` -> `newyorkliberty`, `Minnesota`, `Houston`, `Cincinnati`, `Charlotte`), and so are the benign ones (`Ipswich` -> `ipswichtown`, MLS `Columbus` -> `columbuscrew`). The rule calls all eight RESOLVED, which clears the wrong rows. It is kept as a regression guard in `scripts/check-team-key-substitution.mjs` (section G).

What was built, to the CC-CMD's stated intent (a benign alias is not an alarm; a wrong row still is): `classifySubstitution(key, ownKeys, alsoIn)` in `src/identity-resolver.js`. A substituted key is RESOLVED when it is a team in the row's OWN sport's vendor feed and in no other probed sport's; SUBSTITUTED when it is not; UNCHECKED when there is no feed (the route lists an entry only after its own sport's feed was read, so `key_unchecked` is 0 today; an EMPTY feed corroborates nothing and counts as SUBSTITUTED). `/identity/mismatches` now returns `key_resolved`, `key_substituted` and `key_unchecked` (for each distinct sport in `?sports=` they add up to the count `key_substituted` used to be; a sport named twice has one entry), and each listed entry carries `corroborated: true | false | null`. `key_substituted_cross_sport` is unchanged. CONTRACTS.md has no entry for this route and no other repo reads it (searched jubilant-bassoon, field-laboratory and field-playground 2026-11-22: none), so there is no contract to sync.

Limits, stated where the number is read: corroboration is not proof (a real team of the right sport can still be the wrong one for the row, two schools called Miami), and a feed that does not list a team's game cannot corroborate it, so that alias stays SUBSTITUTED. Absent evidence is not read as benign.

Evidence it works: `check-team-key-substitution` 59 -> 78; `check-identity-route-join` 41 -> 50 (section J12), which runs the real worker (EPL and CFB probed together: 3 resolved, 6 substituted; EPL alone, the shape this CC-CMD measured: 3 resolved, 0 substituted; a feed without the Ipswich v Man City event: both substituted; a key a second probed sport also carries: not resolved, `also_in` names it). The EPL pairings are constructed from real archive spellings, not rows the archive holds. Mutations 25 -> 35 in place and 32 -> 41 on a copy, each red by its named assertion, including M25/J34, the CC-CMD's literal rule.

Measured before building, for the record (read with the relay probe tool on 2026-11-22; not committed as an artifact, and re-runnable: `GET /identity/substitution-census?sport=EPL` is free and ungated): the census route reported `substituted_rows 100` of 135 EPL rows, 137 sides, `ambiguous 0`, no cross-sport rows. Every one is a benign alias, which is the complaint of Defect 2 in numbers.

### Task 2: built in field-laboratory (LAB-FIRST), not here

`scripts/epl-alias-coverage-check.mjs` in field-laboratory, run daily by the drift sentinel with a read-only checkout of this repo's resolver. It compares the 20 clubs of `/espn-standings/soccer/eng.1/standings` with the names FPL and the archive (current season only) use, through this resolver. An ORPHAN (a feed name that reaches no league club) or an FPL club with no name is a gap; a feed it could not read is NOT MEASURED; both are red. "Absent from any alias path" is read as "reached by no feed's spelling", not as "has no `CANONICAL` entry": a club every feed spells identically needs no alias. Checked against this repo's real resolver from before `7191291f`, it goes red on exactly Defect 1: `C Palace` an orphan and `Crystal Palace` unseen in the archive. Against the current resolver, on recorded real names served by a local stub, it reads 20 of 20, covered; its first run on live routes is the sentinel's.

**Client inverse, reported and not fixed (different repo):** `jubilant-bassoon` `src/legacy/field.js:20277` (main `8a1f516a`, 2026-11-22; the CC-CMD's 19869 has drifted) still maps `'Wolves'` and `'West Ham'`, neither in the 2026-27 table.

### Done condition

| condition | state |
|---|---|
| `/identity/mismatches` re-run for three matchdays, payloads verbatim | NOT MET. The route is gated and each call spends billed Odds credits, and a standing instruction in the session that did this work forbids Odds calls. Replaced for Defect 1 by the D1 read, the census and the resolver run above. Unblock: the owner authorizes up to 9 credits (three EPL calls at 3 each, edge-cached 900 s, under the route's 150 a day) or accepts the Saturday probe below. |
| `C Palace` resolves; every other abbreviated D1 spelling listed and fixed | MET: 34 of 34 spellings resolve to 23 keys, none unresolved |
| RESOLVED and SUBSTITUTED reported as separate counts | BUILT and proven on the real worker locally; deployed-route reading STAGED, below |
| Seasonal check reports 20 of 20, or names the gaps | MET in field-laboratory against recorded real data and the real resolver; its first live run is the sentinel's |

### STAGED: the new counts on the deployed route (Rule 74)

Staged: `key_resolved`, `key_unchecked` and `corroborated` on the deployed `/identity/mismatches`. Blocked by: the route being gated and billed. Unblocked by: the scheduled `odds-identity-join-saturday.yml` (cron `40 23 * * 6`, next 2026-11-28 23:40Z) committing `outbox/odds-join-probe-<stamp>.json`; it probes CFB, NFL, Bundesliga and MLS, not EPL, so the EPL case is proven by the local worker run above and not by that payload. Verify, tested to fail on the 2026-11-22 payload (which predates the fields) and to pass on a correct one:

```
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).report
const entries = Object.values(r.sports || {}).flatMap(e => (e && Array.isArray(e.key_substituted)) ? e.key_substituted : [])
console.log(`resolved ${r.key_resolved}, substituted ${r.key_substituted}, unchecked ${r.key_unchecked}, listed ${entries.length}`)
console.assert(typeof r.key_resolved === "number" && typeof r.key_unchecked === "number", "the totals carry key_resolved and key_unchecked")
console.assert(r.key_resolved + r.key_substituted + r.key_unchecked === entries.length, "the three counts add up to the entries listed")
console.assert(entries.every(e => e.corroborated === true || e.corroborated === false || e.corroborated === null), "every entry says how it was counted")
console.assert(entries.filter(e => e.corroborated === true).length === r.key_resolved, "key_resolved is the corroborated entries")
console.assert(entries.every(e => !(e.corroborated === true && (e.also_in || []).length)), "a corroborated entry is carried by no other probed sport")
' outbox/odds-join-probe-<stamp>.json
```

Expected on that payload: no `Assertion failed` line. What this reading proves is that the deployed route returns the new fields, that they add up, and that no corroborated entry is also carried by another probed sport. It cannot tell the corrected rule from this CC-CMD's literal one (a payload holds the keys of six events per sport, not the feed): that distinction is proven locally by J12, M25 and J34. The recorded Saturday payloads carry at most a handful of substitutions (the 2026-11-22 one has CFB `Liberty -> newyorkliberty` only), so expect few entries, each CFB one `corroborated: false`.
