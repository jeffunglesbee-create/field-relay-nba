# Soccer FBref Fetch (Relay-side) — 2026-06-23

## What shipped (relay only)

- `src/index.js` — `POST /soccer/fbref/fetch` (X-FIELD-Relay auth).
  Server-side FBref scraper that bypasses FBref's GH-Actions IP block.
  Hardcoded `FBREF_LEAGUES` table covering wc2026, epl, mls, laliga,
  seriea, bundesliga, ligue1. For each requested league it fetches four
  table types (`shooting`, `misc`, `passing`, `keepers`), unwraps the
  HTML comments FBref hides tables behind, regex-parses `<thead>` for
  `data-stat` column names + `<tbody>` for rows, and emits a
  `{updated, competition, teams:{Squad: {...stats}}}` blob to R2 at the
  configured key. xGDivergence is derived after parsing
  (`goalsFor − xGFor`, rounded 3dp).
- POST gate exception added at index.js:7220.
- `/soccer` added to MCP `probe_relay_route` allow-list (covers
  `/soccer/fbref/*` and any future `/soccer/*` GET probes).

## Rule 77 enforcement

If a league parses to 0 squads, the R2 write is **skipped**, and the
response includes:
- `tablesParsed` count (so you can see how many table regex hits
  succeeded vs how many silently missed the ID),
- `htmlSample` — first 2 KB of the raw FBref response, to diagnose a
  table-ID rename without flying blind.

Empty data is worse than stale data. The existing R2 blobs stay intact
when the scraper fails.

## Commit & deploy

- `72dbdb5` feat: POST /soccer/fbref/fetch — server-side FBref squad-
  stats scraper
- Deploy: workflow 27995864032 — completed/success.

## Verification status

| Item                                       | Status   | Notes                                                                 |
|--------------------------------------------|----------|-----------------------------------------------------------------------|
| `node --check src/index.js`                | VERIFIED | OK                                                                    |
| Deploy succeeded                            | VERIFIED | CI run 27995864032                                                    |
| POST gate exception list contains route     | VERIFIED | src/index.js:7220                                                     |
| MCP probe allow-list includes /soccer       | VERIFIED | src/index.js: ALLOWED_PREFIX                                          |
| Endpoint returns >0 squads for wc2026 live  | STAGED   | Sandbox blocks worker.dev egress; trigger from jubilant-bassoon cron or manual curl |
| `/health/sources` soccer_fbref_wc.entries>0 | STAGED   | Depends on first successful POST                                      |

### Unblock criteria for STAGED items (Rule 74)

Trigger any one of:
1. The updated `soccer-fbref-wc.yml` GH-Actions cron (Task 2, jubilant-bassoon
   repo) runs once and POSTs to `/soccer/fbref/fetch`.
2. Manual curl from any host that has worker.dev access:
   ```bash
   curl -s -X POST \
     -H "X-FIELD-Relay: field-relay-cron-2026" \
     -H "Content-Type: application/json" \
     -d '{"leagues":["wc2026"]}' \
     https://field-relay-nba.jeffunglesbee.workers.dev/soccer/fbref/fetch
   ```
   Expected: `{"ok":true,"results":[{"league":"wc2026","squads":32,"ok":true,...}]}`

Then within ~5 min:
```bash
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health/sources | jq '.sources[] | select(.key=="soccer_fbref_wc")'
# expect entries to bump from 0 → 32, ageHours small
```

## Tasks 2 & 3 — Out of this repo's scope (jubilant-bassoon)

This session is scoped to `field-relay-nba`. The two workflow YAML
updates the spec asks for live in `jubilant-bassoon`. Apply them in
that repo. Both are simple drop-ins:

### `.github/workflows/soccer-fbref-wc.yml` (replace entire file)

```yaml
name: Soccer FBref Stats Update
on:
  schedule:
    - cron: '0 8 */3 * *'
  workflow_dispatch:
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger relay FBref fetch
        run: |
          RESULT=$(curl -s -f -X POST \
            -H "X-FIELD-Relay: field-relay-cron-2026" \
            -H "Content-Type: application/json" \
            -d '{"leagues":["wc2026","epl","mls","laliga","seriea","bundesliga","ligue1"]}' \
            https://field-relay-nba.jeffunglesbee.workers.dev/soccer/fbref/fetch)
          echo "$RESULT"
          echo "$RESULT" | python3 -c "
          import json,sys
          d=json.load(sys.stdin)
          failed=[r for r in d.get('results',[]) if not r.get('ok')]
          if failed:
              print('FAILED leagues:', [r['league'] for r in failed])
              exit(1)
          print('All leagues OK')
          "
```

### `.github/workflows/soccer-fbref-mls.yml` (replace entire file)

```yaml
name: Soccer FBref MLS Stats Update
on:
  schedule:
    - cron: '0 8 * * 1'
  workflow_dispatch:
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger relay FBref fetch (MLS)
        run: |
          curl -s -f -X POST \
            -H "X-FIELD-Relay: field-relay-cron-2026" \
            -H "Content-Type: application/json" \
            -d '{"leagues":["mls"]}' \
            https://field-relay-nba.jeffunglesbee.workers.dev/soccer/fbref/fetch
```

Both workflows now require zero Python deps and no repo checkout —
they just curl the relay.

## Carry-forwards

1. **End-to-end proof pending.** No live FBref fetch has run yet —
   only the syntax and route plumbing are confirmed. First scheduled
   cron tick after deploy will be the real test. If `squads === 0` for
   any league, the response payload includes the raw HTML sample for
   diagnosis — surface it in the GH Actions log.
2. **Per-league errors are visible but non-fatal.** A league that 403s
   just becomes `{ok:false, error:'...'}` in the results array and the
   previous R2 blob is preserved. The workflow's Python check exits 1
   on any failure so the GH job goes red — good signal.
3. **Table IDs may drift.** FBref renames table IDs occasionally. The
   `pickInt` / `pickFloat` helpers already accept fallback column
   names (`gf` ← `goals_gk`, `kp` ← `assisted_shots`, etc.). If a
   future rename breaks things, add the new column name as another
   fallback rather than rewriting the parser.
4. **Comment unwrap.** FBref hides about half its tables inside
   `<!-- ... -->` blocks. The `unwrapComments` pre-pass handles this,
   but it's a flat strip — if FBref ever nests legit comments inside
   table HTML, this would mangle them. Currently no observed cases.
5. **Per-request runtime.** 7 leagues × 4-5 table fetches × FBref's
   ~1 s typical response = ~30 s per full run. Stays under CF
   Worker's 30-s soft limit but close — keep `requested` arrays small
   when possible (the MLS workflow correctly does only `["mls"]`).
6. **Health sentinel.** The `soccer_fbref_*` keys in
   `src/stale-data-sentinel.js` will now flip from `entries: 0` to a
   real count once the first POST succeeds. No sentinel change
   needed.

## Verify commands

```bash
# Once the cron has fired (or manual curl from a non-sandboxed host):
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health/sources \
  | jq '.sources[] | select(.key | startswith("soccer_fbref"))'

# Context Assembler should now hydrate soccer games:
curl -s 'https://field-relay-nba.jeffunglesbee.workers.dev/context/date/2026-06-23' \
  | jq '.[] | select(.sport=="wc26") | {id, contextLength}'
```
