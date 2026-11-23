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

## Kali fix manifest (CC-CMD Task 4)

| item | value |
|---|---|
| commits | `e3b526b` (guard, marker, check script, `deploy.yml` step, runner excerpt) and `0a02e78` (docs: the CC-CMD records the marker; the two guard fixes below) |
| deploy runs | `45086422794` on `e3b526b`: **failed** at the citation gate (14 bare citations against a budget of 9, five of them in `outbox/aflw-source-read-20261122.md`), so the fix was not live; `45087842267` (`workflow_dispatch` on `0a02e78`, 00:16:57Z to 00:26:22Z): **success**. A docs-only push does not trigger `deploy.yml` (its paths are `src/**`, `wrangler.toml`, `workers/**`), so the second run was dispatched by hand |
| Task 0 probe | `probe-url.yml` run 45084086791: `/api/afl/v1/predictions?year=2026`, `/teams`, `/fixture` each `HTTP 200, 5818 bytes`, `<title>kali-afl — back in 2027</title>`; `aflapi.afl.com.au/robots.txt` `HTTP 404, 275 bytes`; excerpt committed as `outbox/kali-holding-page-head-20261122.html` (400 bytes) |
| check, fixed file | `node scripts/check-kali-nonjson-not-cached.mjs`: `checked 8 of 8 cases (16 assertions)`, `self-test passed`, exit 0 |
| check, unfixed file | same script with `HELPERS_MODULE` pointed at `git show 345715d:src/cache-helpers.js`: `SELF-TEST FAILED: 8` (a1, a2, a3, a4, a5, a7, e1, g1) |
| mutations | `--mutate`: `mutations: 15 of 15 caught`, exit 0; the harness counts an assertion that throws as a failure |
| ten calls against the holding page | HEAD `{"upstream":1,"bearerSends":1,"kvPuts":1,"lastStatus":200}`; refusal alone `upstream:10, bearerSends:10, kvPuts:0, lastStatus:502`; committed `{"upstream":1,"bearerSends":1,"kvPuts":1,"keys":["not-json:..."],"lastStatus":502}` |
| Repo guards on `0a02e78` | run `45087398899`: steps 6 (citations) and 58 (status lines) **success**; step 45 (BSD frame contract) **failure**, which predates this work: run `45073480764` (`1bd5ba1`, another session, 21:41Z) failed at that step alone, and the five runs back to `45066353369` (20:25Z) are red. Not investigated further, not touched |

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
- My first push of the Kali fix failed its deploy and its guards for reasons that were mine, and I pushed two earlier docs commits (`2206693`, `f1f82ed`, `ae8b9db`) without reading Repo guards for them. The evidence file's five bare `file:line` citations broke the citation ratchet (14 against 9) and both new CC-CMDs wrote `**Status: WORD**` where the checker requires `**Status:** WORD`. Both checkers ran locally in seconds; I ran neither before pushing. The deploy gate is the same citation step, so a docs file blocked a code deploy. Fixed in `0a02e78`; the deploy was dispatched by hand because a docs push does not trigger it. For the next docs commit in this repo: run `node scripts/check-doc-citations.mjs` and `node scripts/cc-cmd-status-check.mjs` before pushing.
- The first version of the Kali guard made things worse and I had not measured it: refusing the page without remembering it turned one upstream call per hour into one per request. The independent reviewer ran ten calls and found it; I reproduced it (HEAD 1, guard alone 10) before changing anything, then added the marker. The lesson is the CC-CMD's own premise 2 applied to my fix: I had asked what the old code did when the host answered, and not what the old accident was also doing for free.
- Three defects were in the check, not the helper: my padding arithmetic made the fixture 5828 bytes, not 5818 (its own assertion failed at the first run); the same assertion counted characters, not bytes (the reviewer); and one mutation made an assertion throw instead of fail, which the harness reported as an error rather than a catch. All fixed; assertions are now exception-safe.
- The first answer of this turn listed "the AFLW 2026 season's dates" as not read. It was readable in one fetch of the rounds endpoint; the answer under-reached rather than checking. Fixed by the read above.

## AFLW build, 2026-11-23 (the owner's delegation: "Go with Claude's best recommendations")

**The recommendation and why.** G0 = A, `aflapi.afl.com.au`: free, first-party, unauthenticated, serves AFLW, a Worker IP reads it; Champion Data is a licence nothing here can buy before 2026-11-27, and "none" leaves the one AFLW match of 2026 unserved. It is built so that being wrong is cheap: pull only, a refusal or an unread status is a named 502 and never an empty slate or a guess, stage 1 maps only SCHEDULED and CONCLUDED, and the whole dependency is one `V2_LEAGUES` key, one adapter and one archive writer. No terms were assessed (Rule 45); the quoted text stays in `outbox/aflw-source-read-20261122.md` for the owner.

| item | value |
|---|---|
| commits | `853a754` (G0 ruled, the archive-seed premise corrected), `9ef280d` (the feed), `d002716` (the archive step), `35c96f6` (the live-hours note); jubilant-bassoon `05f899a` and `b4e1ef2` (CONTRACTS.md sync); field-laboratory `00200dc1` (the lab half) |
| deploys | `45102807472` on `9ef280d`: success (the feed); `45105732040` on `d002716`: success (the archive step) |
| D2, read on the deployed relay | `/v2/games?sport=aflw&date=2026-11-27`: 200, the Grand Final `aflw:9081` `pre` in the contract shape, scores null; `date=2026-11-21`: the preliminary final `aflw:9079` `final`, Melbourne 75, Carlton 45; re-read after the second deploy, unchanged |
| feed check | `scripts/check-v2-games-aflw.mjs`: 17 of 17 cases, 21 assertions, 16 of 16 mutations caught |
| archive check | `scripts/check-aflw-archive-seed.mjs`: 14 of 14 cases, 20 assertions (case R: the real `/archive/game` route writes `AFLW_2026-11-27_northmelbourne_melbourne`, `espn_event_id` `aflapi:9081`), 16 of 16 mutations caught |
| gates | every pre-deploy `run:` step of `deploy.yml` run locally: 125 of 128 passed on the first sweep (the other 3 refuse to mutate a dirty tree and passed on the clean one after the commit) and the 3 KV bootstrap steps need a token, so were not run |
| D2b | not read: no AFLW row is on `/context/date/2026-11-27` yet (the cycle's first tick that can seed it is about 10:00Z on 2026-11-24). Scheduled: `send_later` 2026-11-24T12:00Z, `trig_01FCaLrmedqkcp3oRP7RXruP` |

**STAGED (Rule 74), with the verifiers.** (1) D2b: blocked by the cron's live hours (the cycle returns early in UTC 03:00 to 09:59); unblocked 2026-11-24 about 10:00Z; verify `probe_relay_route /context/date/2026-11-27` shows the Grand Final row; verifier `trig_01FCaLrmedqkcp3oRP7RXruP`. (2) Stage 2 of the feed (the live spelling, period, clock): blocked until a match is in play; unblocked 2026-11-27T08:45Z; the seven Grand Final reads write the answer; the adapter then maps the spelling (it is a 502 until then). (3) D3, a `live-score-probe` PASS on an AFLW card: after D2b and the Grand Final, or August 2027. (4) The Playwright spec `AVV-AFL-002` (see the Kali CC-CMD): manual only.

**Incidents (Rule 77).**
- Every CONTRACTS.md push of mine since 2026-11-22 18:45Z (`85127fb`, `8bdac8e`, `72faa99`, `9ef280d`) failed `contracts-identity-check.yml`, because the file must be identical in jubilant-bassoon and I never copied it over; I wrote "the laboratory's copy must be synced" and meant the wrong repo. I read the red on the fourth push, copied the relay's file over jubilant-bassoon's (a superset: 5 changed lines, 74 added) and pushed it (`05f899a`), then did the same for the next change before pushing the relay (`b4e1ef2`): the check passes on `d002716`. The CONTRACTS.md section now says both copies.
- The first version of the feed check could not fail on a missing sort (the fixture list was already in start order): its mutation survived, so I reordered the fixture and the mutation is caught.
- My first plan said to seed `aflw` in the cron's `LEAGUES` table. Reading `seed-manifest.js` (`classify` keys on the ESPN slug) and the lab's card source (`/context/date` reads only the archive) showed that was false before any code was written; Task 3 became the archive step.
- `jubilant-bassoon` was on the harness's session branch, not `main`, when I first tried to commit; its pre-commit hook said so and refused. I moved to `main` (its CLAUDE.md: every commit goes to `main`) and pushed there.
- Not mine, recorded (RESOLVED 2026-11-23, `db92f6f`: the step's census hit a fixed read cap of 2500, from run `45043402749` at 16:21Z, not 20:25Z; see `outbox/cc-session-2026-11-23-bsd-frame-census-ceiling.md`): Repo guards is still red at the BSD frame step; the Provenance Runtime Probe's two inner FAILs are deterministic (a query-string target against a bare path) and its failure on 2026-11-23T03:05Z was a push race in its own commit step.
