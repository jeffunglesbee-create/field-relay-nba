# CC-CMD: Automated post-deploy live verification (closes the manual-curl gap)

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** A GitHub Actions workflow that runs automatically after every
successful deploy, curling a small, extensible list of live endpoints
(reachable from the runner, unlike CC's own sandbox) and writing results
to `outbox/live-verify-{run_id}.md`. This is the concrete fix for
"terminal work should always be automated" — today's session required
chat to manually curl `/circadian/*` after CC's deploy because CC cannot
reach `*.workers.dev`. This workflow makes that automatic going forward,
for this endpoint and any future one added to the check list.
**Why:** This is the third time in this project's history the
CC-egress-blocked-from-workers.dev problem has caused a stall or a
manual chat pass (documented pattern going back to at least May 2026).
The existing "CI-as-proxy" pattern already solves this at the
Playwright/CI-log level for client-repo work; this CC-CMD builds the
equivalent for simple relay endpoint health/data checks, which don't
need the full Playwright machinery.
**Target time:** ~45 min

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- *.workers.dev:443 blocked from CC egress — this is exactly the
  constraint this CC-CMD exists to route around, via a GitHub Actions
  runner (which CAN reach it), not by trying harder from CC's own sandbox
- api.github.com is reachable from CC bash
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail
- Validate YAML before commit (a linter or `python3 -c "import yaml; yaml.safe_load(open('...'))"` if PyYAML is available; otherwise careful manual review)

## CONFIDENCE GATE (CC-verifiable only — see note)
This CC-CMD is unusual: its own DONE CONDITION requires seeing the
workflow actually run and produce a real outbox file, which only happens
after a deploy triggers it. Score what you can (YAML validity, workflow
logic correctness, trigger configuration) and commit once that's ≥ 95.
The "did it actually fire and produce real output" confirmation is
inherently deferred to the NEXT deploy after this one ships — note this
explicitly in your outbox rather than waiting for it in this session.

## TASK 1 — Add the workflow

Create `.github/workflows/post-deploy-live-verify.yml`:

```yaml
name: Post-deploy live verification
on:
  workflow_run:
    workflows: ["Deploy RELAY Worker"]  # confirmed exact name via
                                          # `grep "^name:" .github/workflows/deploy.yml`
                                          # 2026-07-04 — do not re-guess this
    types: [completed]

jobs:
  verify:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Live-check endpoints
        run: |
          DATE=$(date -u +%Y-%m-%d)
          YESTERDAY=$(date -u -d "yesterday" +%Y-%m-%d)
          OUT="outbox/live-verify-${{ github.event.workflow_run.id }}.md"
          mkdir -p outbox
          {
            echo "# Post-deploy live verification"
            echo "Run: ${{ github.event.workflow_run.id }} · Commit: ${{ github.event.workflow_run.head_sha }} · $(date -u)"
            echo
            echo "## /circadian/preview + /circadian/late (today + yesterday)"
            for phase in preview late; do
              for d in "$DATE" "$YESTERDAY"; do
                echo "### $phase / $d"
                curl -sf "https://field-relay-nba.jeffunglesbee.workers.dev/circadian/$phase/$d" || echo "REQUEST FAILED"
                echo
              done
            done
            echo "## Validation checks"
            echo "### bogus phase (expect 400)"
            curl -s -w "\nHTTP:%{http_code}\n" "https://field-relay-nba.jeffunglesbee.workers.dev/circadian/bogus/$DATE"
            echo "### bad date (expect 400)"
            curl -s -w "\nHTTP:%{http_code}\n" "https://field-relay-nba.jeffunglesbee.workers.dev/circadian/preview/not-a-date"
          } > "$OUT"
          cat "$OUT"

      - name: Commit results
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add outbox/live-verify-*.md
          git commit -m "chore: post-deploy live verification [skip ci]" || echo "nothing to commit"
          git push
```

**CC: this endpoint list (`/circadian/preview`, `/circadian/late`) is a
starting point, not exhaustive.** Extending it later for new endpoints is
expected and cheap — a follow-up CC-CMD or even a direct small edit
(confirm with chat which is appropriate given this file's low-risk,
append-only nature) can add more curl blocks to the same script.

## TASK 2 — Workflow name already confirmed
Chat confirmed via direct grep 2026-07-04: `.github/workflows/deploy.yml`
has `name: Deploy RELAY Worker` — already used correctly above. No
action needed here; this section intentionally left as a record of what
was checked and how, not as a TODO.

## DONE CONDITIONS
- [ ] YAML validated
- [ ] Pushed to main
- [ ] Outbox note explicitly states: "This workflow's actual firing and
      output will only be confirmed on the NEXT deploy after this one —
      not verifiable in this session, by design"

## COMPLIANCE
- Rule 68: probe (TASK 2) before writing the trigger config
- Rule 87: as noted above, full self-completion is deferred by one deploy cycle — documented explicitly, not glossed over

## OUTBOX MANIFEST
- [ ] .github/workflows/post-deploy-live-verify.yml created
- [ ] Real deploy workflow name used (not guessed)
- [ ] Explicit statement that this closes the "chat manually curls after every deploy" gap going forward

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-post-deploy-live-verify.md. The
deploy workflow name is already confirmed ("Deploy RELAY Worker", see
TASK 2) — do not re-derive it. Implement exactly as specified. Do not
commit unless confidence ≥ 95 on the CC-verifiable portion (see
CONFIDENCE GATE note — full firing confirmation is deferred by design,
not blocking).
