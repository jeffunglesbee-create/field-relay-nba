# Claude Code Command — two READ_ALLOWLIST entries, and the CORS probe chat is documented to run but cannot

**Date:** 2026-10-12
**Repo:** field-relay-nba — **the MCP server lives here, `src/index.js`** (per
`docs/CC-CMD-2026-07-10-mcp-multi-repo-create-support.md`). Task 2 also touches
jubilant-bassoon.
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (gap) — tool surface, plus one measurement chat is locked out of
**Status:** FILED, not started.

**RULE 80/81 APPLIES TO TASK 1.** `src/index.js` is the sole holder of
`GITHUB_PAT` for every chat session. The 07-10 document's own warning stands:
*"this handler is the sole holder of GITHUB_PAT for every chat session. Treat it
accordingly."* Re-verify every constant against HEAD before editing, change
nothing structural, and do not restructure `isPathAllowed`.

## Why this exists

Both halves were approved by the owner tonight and **chat cannot execute
either**. The second one is the more interesting failure.

## TASK 1 — add exactly two entries to `READ_ALLOWLIST`

Current value, as the 07-10 document records it and as the live tool
description still reports (unchanged for three months):

```js
var READ_ALLOWLIST = [
  "index.html", "src/", "docs/", "scripts/", ".github/",
  "CODE_MAP.json", "HANDOFF.md", "STANDARDS.md", "README.md", "CLAUDE.md"
];
```

Add **two exact paths, not a prefix**:

```
"STATUS.md"
"outbox/drift-log.md"
```

**Exact-match is available and is the point.** `isPathAllowed` tests
`path === prefix || path.startsWith(prefix)`, so a non-slash-terminated entry
matches that one path and nothing else. Adding `"outbox/"` instead would open
the whole directory **in every repo the resolver can reach**, and this repo's
`outbox/` holds a hundred-plus session docs plus fill logs
(`targeted-odds-fill-*.log`) and probe artifacts. Widening a shared prefix to
read two files is not the same decision it looks like.

**What this unblocks:** `field-laboratory` renders its drift-sentinel verdict
into `STATUS.md` from `outbox/drift-log.md`, and chat cannot read either, so
drift-sentinel state has been unreportable for three consecutive verification
pulls. `get_deploy_status` caps at five runs with no per-workflow filter, so
there is no second route.

**Verify after:** `read_file` on `field-laboratory/STATUS.md` and
`field-laboratory/outbox/drift-log.md` both succeed, and `read_file` on
`field-relay-nba/outbox/` anything still returns `Path not in READ_ALLOWLIST`.
The second assertion is the one that proves a prefix was not added by accident.

## TASK 2 — run the CORS probe against Nominatim, which chat is locked out of

**The measurement wanted:** does `nominatim.openstreetmap.org` send
`access-control-allow-origin`, and does it need a request `Origin` to do so.
This fills the one field that cannot be filled for the OSM row in
`jubilant-bassoon/docs/source-registry.json` — see Task 3.

**Why chat cannot do it, measured tonight:**

```
commit_file outbox/.trigger-cors-probe
  → "Path not in WRITE_ALLOWLIST: outbox/.trigger-cors-probe"
WRITE_ALLOWLIST = ["docs/", "HANDOFF.md", "CODE_MAP.json"]
```

**`STANDARDS.md` documents a pattern chat cannot execute.** Its CI-as-proxy
section says, as step 1: *"Write target URL to `outbox/.trigger-cors-probe`."*
That path has never been writable by the MCP surface. The escape hatch
STANDARDS.md offers for every sandbox-blocked domain is, for chat, decorative.
Dispatching `cors-probe.yml` without writing the trigger first probes whatever
URL the file currently holds, so it is not a workaround.

Run it with:

```
url=https://nominatim.openstreetmap.org/search?q=Lambeau+Field&format=json&limit=1
limit=1200
maxtime=20
```

**AND FIX THE PROBE'S OWN BLIND SPOT FIRST, or the result is uninterpretable.**
`.github/workflows/cors-probe.yml` sends no `Origin` header. It has an
`accept=` field and nothing else. That is the exact mechanism behind the
documented false negative in
`field-playground/.github/workflows/open-meteo-probe.yml`'s first run, recorded
verbatim in the July 21-28 session doc: *"the FIRST probe reported NO
access-control-allow-origin header. That was a bug in the probe — curl sent no
Origin, so none could come back. That false negative would have pointed the fix
squarely at building a relay proxy that should not exist."*

A server that emits a static `*` answers without an Origin; a server that echoes
the request Origin cannot. So **a NO result from the current workflow is
inconclusive, and a NO is exactly the answer that would send someone to build a
relay route.** Add an `origin=` field, read the same way as `accept=`, and send
it on both the GET and an `OPTIONS` preflight — the open-meteo probe already
does both and is the pattern to copy.

**A DEFECT IN THAT WORKFLOW, REPORTED AND DELIBERATELY NOT EXPLOITED.** The
step builds `-H "Accept: ${ACCEPT}"` with the value interpolated inside double
quotes, read from a committed file. A value containing a quote character
terminates the string and injects further `curl` arguments. Chat noticed this
while looking for a way to smuggle an `Origin` header through `accept=`, and
did not use it: injecting arguments into a CI workflow to get a measurement is
not a measurement. Quote the expansion or build the header array properly, and
treat the same shape in `URL`, `LIMIT` and `MAXTIME` as in scope.

## TASK 3 — the registry rows the licence work produced

`jubilant-bassoon/docs/source-registry.json` holds four sources. It has **no
OSM row and no Wikidata row**, and `docs/data-sourcing-legitimacy-2026-05-29.md`
has neither either — while the July geocoding probe scored Nominatim 8/8 and
Photon 8/8 against hand-verified coordinates. A source measured as viable and
never registered is the gap this task closes.

**OSM / Nominatim.** `status: green`, conditional. Licence **ODbL 1.0** —
the response body states it: `"Data © OpenStreetMap contributors, ODbL 1.0"`.
`authRequired: false`. `corsAvailable:` **from Task 2, not assumed.** Usage
policy: 1 req/sec ceiling, identifying User-Agent required, bulk geocoding
discouraged, results cached 30 days.

Record the share-alike boundary, because it is the reason this row needs prose
rather than flags. Per the OSMF's board-endorsed *Geocoding Guideline*
(endorsed 2017-08-24), quoted:

> "Since individual Geocoding Results are insubstantial extracts, they may be
> stored and used together with other proprietary or third party data without
> having a share-alike impact on such other data, provided the Geocoding
> Results have not been aggregated to create a new database that contains the
> whole or a substantial part of the OSM database."

Three facts that follow, and each belongs in the note:

1. **Share-alike does not reach FIELD's own data** for a venue-coordinate
   lookup. The guideline's own worked example is a retailer geocoding store
   locations: the results are not subject to share-alike and the stored records
   need no attribution.
2. **Attribution attaches to an application that incorporates a geocoder**, not
   to the stored rows. So a build-time generation that freezes constants and
   ships no geocoder carries no UI obligation, while a runtime call does.
   Carry the attribution line regardless — it is one string.
3. **Geometry is not a Geocoding Result.** The guideline covers "only names,
   addresses, and/or latitude/longitude information." A `polygon_geojson`
   footprint is raw database content and sits outside this shelter entirely.
   Write that down; it is the boundary a future session will otherwise cross
   without noticing.

The volume bound is a character test rather than a count: a collection is
substantial only if it is *"a systematic attempt to aggregate all or
substantially all Primary Features of a given type … within a geographic area
city-sized or larger"*, and the test is on **function** — a collection counts if
it functions as a general-purpose geodatabase however it was built. ~98
purpose-selected stadiums across three continents is not that. State the scope
bound in the row so scope creep is visible.

**Wikidata.** `status: green`. Licence **CC0** — no attribution, no share-alike.
Measured tonight: `Q860790` → `P625` returns Lambeau Field at
**44.501389, −88.062222**, about **50 m** from Nominatim's answer, against an
Open-Meteo grid that snapped 1.2 km at Denver and 1.8 km at Detroit. The July
probe scored it 7–8/8 with deltas of 10–350 m. It is the zero-licence-surface
route at a cost of roughly one venue in eight, and OSM returns the QID for free
on the same call, so the two compose.

## Stop conditions

- **Do not restructure the MCP handler.** Two array entries, nothing else. If
  Task 1 tempts a change to `isPathAllowed` or the repo resolver, STOP.
- **Do not add `"outbox/"` as a prefix.** Two exact paths.
- **Do not exploit the `accept=` injection** to obtain the Task 2 measurement.
  Fix it, then measure.
- **Do not interpret a NO-ACAO result from a probe that sent no Origin.** If
  `origin=` is not wired first, report the measurement as not taken.
- Do not fill `corsAvailable` for Nominatim from anything but Task 2's run.

## Done conditions

1. `READ_ALLOWLIST` carries exactly two new exact-match entries; relay
   `outbox/` is still refused; both laboratory files read.
2. `cors-probe.yml` accepts an `origin=` field and sends it on a GET and an
   `OPTIONS` preflight; the `-H "Accept: …"` injection surface is closed.
3. A probe artifact records Nominatim's ACAO with an Origin sent, and the
   verdict names which it was.
4. `source-registry.json` has an OSM row and a Wikidata row, with
   `corsAvailable` for OSM taken from (3) and the three share-alike facts
   written as prose.
5. `STANDARDS.md`'s CI-as-proxy section says who can write the trigger file,
   since chat cannot.
