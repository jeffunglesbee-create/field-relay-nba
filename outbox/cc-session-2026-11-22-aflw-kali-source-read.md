# Session record: the AFLW source read and the Kali shutdown (Rule 67)

Written 2026-11-22 on `main`, field-relay-nba. Owner direction of 2026-11-22: "Search docs on drive and repos for official afl source, aflw should be included", then "Not read section needs to be resolved", then "moving forward on afl/aflw on the larger items/tasks/cc-cmd's". Docs and outbox, then one code change (Kali, below): `src/cache-helpers.js`, one check script and one `deploy.yml` step. No smoke file is affected.

## HEAD progression

| point | where | what |
|---|---|---|
| start | relay `main` `345715d` | no CC-CMD names AFLW or the Kali shutdown (`grep -rli` and `grep -rn -i -E "back in 2027|torn down|offline"` over `docs/`, `outbox/`, `CLAUDE.md`, `HANDOFF.md` of both repos, 2026-11-22) |
| Kali | `2206693` | `docs/CC-CMD-2026-11-22-kali-shut-down.md` |
| AFLW | `f1f82ed` | `docs/CC-CMD-2026-11-22-aflw-live-source.md`, `outbox/aflw-source-read-20261122.md` (evidence), `outbox/aflapi-aflw-gf-9081-baseline-20261122.json` |
| record | the commit carrying this file | this session record |
| Kali fix | `e3b526b` (rebased onto `e5c8297`, a Drive-sweep bot commit) | `src/cache-helpers.js` guard and marker, `scripts/check-kali-nonjson-not-cached.mjs`, `deploy.yml` step, `outbox/kali-holding-page-head-20261122.*` |
| lab | field-laboratory `main` | the AFLW note in `docs/CC-CMD-2026-11-11-live-scores-other-sports.md` Task 3 item 1 now points here and says what is read and what is not |

## What was done

1. **Source search.** Drive: the AFL Data Source Spec (2026-06-26) and AFL Advanced Analytics Spec (2026-05-27) read in full; neither mentions AFLW. Repos: `aflw` appears in one file only (field-laboratory `docs/CC-CMD-2026-11-11-live-scores-other-sports.md`). Web: Champion Data is the AFL's official stats provider (licensed API, AFLW is league id 3); the AFL's own `aflapi.afl.com.au` serves AFLW without a credential (competition 3); ESPN serves no AFLW (core leagues list is `afl` only); Squiggle carries none; Kali is shut down and carries none.
2. **The "not read" items.** Workflow `wf_2a71829f-76b`: five readers (aflapi live fields, the season's state, terms text, Squiggle, Kali) and two skeptics each (source fidelity, overreach). **107 claims; 101 confirmed by both skeptics; 0 refuted; 6 confirmed by one skeptic and flagged by the other for wording stronger than the evidence** (listed per topic in the evidence file). The evidence file is `outbox/aflw-source-read-20261122.md`.
3. **A premise refuted by one command (Rule 100).** "Kali's holding host answers the relay's URLs with an error, so the relay caches nothing": runner `probe-url.yml` run 45084086791 read HTTP 200 with a 5818-byte HTML page for `/predictions?year=2026`, `/teams` and `/fixture`. That is the defect the Kali CC-CMD scopes.
4. **A premise refuted by reading the workflow (Rule 100).** "The Kali Playwright spec fails on its own": jubilant-bassoon `.github/workflows/adapter-visible-value.yml` runs only on `workflow_dispatch`.
5. **Arming.** Seven `send_later` wake-ups on 2026-11-27 (08:40, 08:58, 09:14, 09:40, 10:05, 10:32, 11:30 UTC; trigger ids in the AFLW CC-CMD Task 1) read aflapi match 9081 with `html_probe` from before kickoff to after the final siren and commit each raw body to `outbox/aflapi-aflw-gf-9081-<yyyymmddThhmmZ>.json`.

6. **The Kali fix (CC-CMD Tasks 0 to 3).** `relayFetchKV` refuses a body that does not parse (502 `<source>-not-json`), stores a `not-json:<url>` marker with the same ttl instead of the page, and answers a marker hit without a fetch. The check runs the real helper: 8 of 8 cases, 16 assertions, 15 of 15 mutations caught; against the unfixed file (`git show 345715d:src/cache-helpers.js`) 8 assertions fail. Ten calls against the holding page: HEAD 1 upstream call and 1 Bearer send (the stored page answered the rest), the first version of the guard 10 and 10, the committed version 1 and 1, last status 502 instead of the page served as 200. An independent read-only reviewer found the 1-to-10 regression in the first version, the 5818-bytes-versus-characters slip in my fixture assertion, the unanchored fixture provenance, the literal coverage line and the lost `console.error`; all five were fixed before the push (the marker, bytes and `Buffer.byteLength`, the 400-byte runner excerpt committed in `outbox/`, a `CASES` list the run is counted against, a `console.warn`).

## Verified (artifact beside each)

| claim | artifact |
|---|---|
| ESPN serves one AFL league and no AFLW | `probe-url.yml` run 45081504857 (`count` 1, `leagues/afl`); `probe_relay_route` `/v2/games?sport=aflw` 400 `Unknown sport: aflw` |
| aflapi serves AFLW (competition 3, ids 18 and 19 also AFLW), season 96, 16 rounds, Grand Final match 9081 on 2026-11-27T08:45Z, nothing else left | `html_probe` bodies of 2026-11-22; `outbox/aflapi-aflw-gf-9081-baseline-20261122.json` (1272 bytes, equal to the length the tool reported) |
| A match item carries no period or clock key (SCHEDULED and CONCLUDED) | same baseline, plus the evidence file, topic `aflapi-live-fields` (claim `key1`, confirmed by both) |
| Kali's holding page answers the relay's URLs with 200 HTML | run 45084086791 log |
| `aflapi.afl.com.au/robots.txt` is HTTP 404 (`Whitelabel Error Page`) | run 45084086791 log |
| Squiggle has no AFLW; Kali has none | evidence file, topics `squiggle-aflw` (17 claims; the fidelity skeptic confirmed 17, the overreach skeptic 16 and flagged one for wording) and `kali-aflw` |
| `relayFetchKV` has exactly two callers, both Kali, both fall back on a non-ok answer | `grep -a -n relayFetchKV src/*.js`; code read at `index.js:4421` and `wp-resolver.js:443-459`; the reviewer's independent read agreed |
| The Kali Playwright spec is manual only | jubilant-bassoon `.github/workflows/adapter-visible-value.yml` (`workflow_dispatch` only, push trigger commented out), `63e6eb8` |
| The fix does what the CC-CMD says | `node scripts/check-kali-nonjson-not-cached.mjs` (8 of 8 cases) and `--mutate` (15 of 15); deploy run id in the line below |
| The terms text, quoted | evidence file, topic `terms-text`; Rule 45: no assessment |

## STAGED, not verified (Rule 74)

1. **Does aflapi serve a live status, period or clock for an AFLW match?** Blocked by: no AFL or AFLW match is in play (`status=L` returns 0 rows for competition 3 and competition 1; the Grand Final is the only AFLW match left). Unblocked when: 2026-11-27T08:45Z. Verify: `ls outbox/aflapi-aflw-gf-9081-*.json` shows the seven captures; `node -e` over them listing `status` and keys absent from the baseline; the last wake-up writes the answers (a) to (e) into the AFLW CC-CMD Task 1. Scheduled verifier: the seven triggers above.
2. **Part B (the lab card) and a live AFLW card on the deployed page.** Blocked by: owner ruling G0 and the offseason (AFLW 2026 ends 2026-11-27; the 2027 season is not read). Unblocked when: Part A is deployed and a match is in play. Verify: `live-score-probe.yml` with the ET date, manifest `cardState` `In progress`, `scoreMatchesFeed` true.
3. **Kali's fix against a real AFL slate and a real KV.** The helper is checked with a stubbed fetch and KV (no real expiry); the `/kali/*` route (`relayFetch`) is not changed (owner question O1). Blocked by: no AFL game until the 2027 season. Verify when: the first AFL round of 2027, `probe_relay_route` `/v2/games?sport=afl&date=<ET day>` and read `journalism.kali` per game.
4. **Not read at all:** Squiggle's Event API (SSE) for AFLW (Exa timed out; needs a runner holding the stream); whether `KALI_CACHE` already holds an HTML entry (no KV key read from this session); the AFLW 2027 season date; Champion Data's order form and service level agreement text; whether the Disney terms version of 2024-05-24 is the one in force today.

## Integration state (Rule 65)

- **Relay contract:** unchanged. The proposed `/v2/games?sport=aflw` shape and the aflapi source are in the AFLW CC-CMD Part A, not built.
- **Client consumer:** none. Part B is held behind D2.
- **Status:** UNTESTED for AFLW end to end by design; the source facts are VERIFIED as listed.
- **Known mismatches:** `V2_LEAGUES` has no `aflw` key, `seed-manifest.js` would need a declaration for one, and the aflapi match item has no ESPN event id (the lab joins id-less games by the two club names, as for NHL).

## Carry-forwards (each already written as a CC-CMD or an owner question)

- Owner ruling **G0** (source for AFLW: aflapi, Champion Data, or none), in `docs/CC-CMD-2026-11-22-aflw-live-source.md`. Tasks 2 to 4 and Part B wait on it.
- Owner questions **O1 and O2** (the Kali branches and a replacement), in `docs/CC-CMD-2026-11-22-kali-shut-down.md`. Its Tasks 0 to 4 do not wait on either.
- Rule 45 flag: the quoted terms of the AFL, Champion Data and Disney (which also covers the ESPN endpoints the relay already reads) need a human reader; nothing in this session judges them.

## Incidents (Rule 77)

- The workflow ran two agents at a time (4 CPUs, cap min(16, CPUs - 2)), so 15 agents took 31 minutes instead of about 10. Not a defect in the result; noted so the next fan-out is sized for it.
- Three inaccuracies in my own drafts were caught by re-reading the evidence before the commit: "four same-club double-headers" (three are same-club; the fourth shares a ground and a day), "nine Kali CC-CMDs" (eleven mention Kali), and two `cache-helpers.js` line ranges (`:161-170`, `:148-152`; the code is at `:164-165` and `:147-150`). All three are corrected in the committed text.
- Three claims in the evidence file carry an overreach flag from a skeptic (Champion Data order form is about the Warehouse; Kali's README says "AFL", not "men's"; fitzRoy's use of the AFL site API is wider than four calls). The two that reach the CC-CMDs were reworded to the narrower text before commit.
- The first version of the Kali guard made things worse and I had not measured it: refusing the page without remembering it turned one upstream call per hour into one per request. The independent reviewer ran ten calls and found it; I reproduced it (HEAD 1, guard alone 10) before changing anything, then added the marker. The lesson is the CC-CMD's own premise 2 applied to my fix: I had asked what the old code did when the host answered, and not what the old accident was also doing for free.
- Three defects were in the check, not the helper: my padding arithmetic made the fixture 5828 bytes, not 5818 (its own assertion failed at the first run); the same assertion counted characters, not bytes (the reviewer); and one mutation made an assertion throw instead of fail, which the harness reported as an error rather than a catch. All fixed; assertions are now exception-safe.
- The first answer of this turn listed "the AFLW 2026 season's dates" as not read. It was readable in one fetch of the rounds endpoint; the answer under-reached rather than checking. Fixed by the read above.
