# CC-CMD-2026-08-09-fix-completion-field-superset-regression

**Repo:** field-relay-nba — commit directly to main.

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-09-fix-completion-field-superset-regression.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## A real regression I introduced, isolated but not diagnosed

The deploy `verify` job is FAILING on:
```
Completion field-list superset check -- every COMPLETION_FIELDS member
wired into both /archive/score-by-id and /archive/game
```

**Isolation evidence (already done, do not redo):**
| commit | verify |
|---|---|
| `c8849d9b` "feat: WNBA failover via KV" | **failure** ← first |
| `88c4d434` "feat: CFL archive collection" | failure |

Earlier runs in the same session passed. So this was introduced by
`c8849d9b`, **not** by the CFL commit, and not by anything pre-existing.
`deploy` itself succeeded both times — the worker is live and serving;
this is the verify gate, and it is correctly refusing to go green.

`COMPLETION_FIELDS = ['home_score','away_score','went_to_ot',
'finalized_at','espn_event_id']` (`src/index.js` ~line 6958).

## Why this CC-CMD exists rather than a fix

I ran out of context budget to read the check's base64 payload and
diagnose it properly. Guessing at a fix for a gate whose logic I have not
read is exactly the failure mode Rule 77 forbids, and it is how you get a
"fix" that makes the check pass without making it correct.

## Task 1 — read the check before touching anything

Decode and read the `Completion field-list superset check` step's base64
payload in `.github/workflows/deploy.yml`. Establish **what it actually
parses** — the `/archive/game` and `/archive/score-by-id` handler
regions, a field-occurrence count, or something else — and how the
boundaries of those regions are determined.

**Artifact:** the decoded logic quoted, and a one-line statement of what
it asserts.

## Task 2 — reproduce locally, then identify the real cause

Run the decoded check against `src/index.js` at HEAD and again at
`c8849d9b~1`. **Artifact:** both outputs, showing the exact field(s) it
now reports as unwired.

Candidate causes to test, not to assume — `c8849d9b` added:
- `adaptWnbaCDN` + `fetchWnbaSlateFromKV` (new `home_score`/`away_score`
  adjacent text, which would break a **count**-based assertion)
- `POST /wnba/slate` (a new route, which would break a **region**-based
  parse if boundaries are delimited by the next route)
- the `_v2FetchedAt` / `staleSeconds` response spread

## Task 3 — fix the RIGHT layer

If the check's parse is too fragile (region boundaries shifting when an
unrelated route is added), **fix the check** — that is a real defect and
a third session will hit it. If a COMPLETION_FIELDS member genuinely is
unwired, fix the handler. Do not relax the assertion to make it pass;
this gate exists because completion fields silently missing from one
write path is a real, previously-shipped bug class.

**Artifact:** a green `verify` job on a real deploy run, with the step's
passing output quoted.

## Explicitly NOT in scope

Do not revert the WNBA or CFL features — both deployed successfully and
are verified working end to end.

## Outbox

`outbox/cc-session-2026-08-09-fix-completion-field-superset-regression.md`
