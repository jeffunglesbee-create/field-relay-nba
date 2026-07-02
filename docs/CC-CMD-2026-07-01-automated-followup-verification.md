# Claude Code Command — Automate Pending Follow-Up Verification

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-automated-followup-verification-2026-07-01.md.

## CONTEXT

Two real conditions are currently sitting as manual "chat-side
follow-up" notes, requiring someone to remember to re-check later:

1. Does `change_log` have a real `source: 'savant'` row yet — the proof
   the xERA pipeline + `reconcile()` chunking fix (both shipped
   2026-07-01) actually works end-to-end, not just that the code is
   syntactically correct.
2. Does `briefs` have a `source: 'completion-trigger'` entry yet — the
   proof journalism actually fires on game completion (shipped
   2026-07-01, commit a89e71e), not just that the code deployed.

Both are event-triggered (need real games/data to occur), so a fixed
schedule check is the right mechanism — not a one-time verification,
since the triggering event hasn't necessarily happened yet at any
single check time.

## PRE-BUILD PROBE (Rule 87)

```bash
grep -n "'/d1/execute'" src/index.js
sed -n '9628,9660p' src/index.js
```

Confirm the exact real request/auth shape `/d1/execute` expects before
building a workflow that calls it.

## TASK 1: New scheduled workflow

Create `.github/workflows/verify-pending-checks.yml`:

```yaml
name: Verify Pending Follow-Up Checks
on:
  schedule:
    - cron: '0 */6 * * *'  # every 6 hours
  workflow_dispatch: {}

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Check savant change_log entry
        id: savant
        run: |
          RESULT=$(curl -s -X POST https://field-relay-nba.jeffunglesbee.workers.dev/d1/execute \
            -H "X-FIELD-Relay: field-relay-cron-2026" \
            -H "Content-Type: application/json" \
            -d '{"sql": "SELECT COUNT(*) as n FROM change_log WHERE source = ?", "params": ["savant"]}')
          echo "result=$RESULT" >> "$GITHUB_OUTPUT"
          echo "$RESULT"

      - name: Check completion-trigger brief entry
        id: journalism
        run: |
          RESULT=$(curl -s -X POST https://field-relay-nba.jeffunglesbee.workers.dev/d1/execute \
            -H "X-FIELD-Relay: field-relay-cron-2026" \
            -H "Content-Type: application/json" \
            -d '{"sql": "SELECT COUNT(*) as n FROM briefs WHERE source = ?", "params": ["completion-trigger"]}')
          echo "result=$RESULT" >> "$GITHUB_OUTPUT"
          echo "$RESULT"

      - name: Log results to codex if either newly passed
        run: |
          python3 -c "
import json, urllib.request

savant = json.loads('''${{ steps.savant.outputs.result }}''')
journalism = json.loads('''${{ steps.journalism.outputs.result }}''')

savant_n = savant.get('results', [{}])[0].get('n', 0)
journalism_n = journalism.get('results', [{}])[0].get('n', 0)

print(f'savant change_log entries: {savant_n}')
print(f'completion-trigger briefs: {journalism_n}')

# Only write to codex if at least one condition newly passed —
# avoid spamming an update every 6h with 'still 0'.
if savant_n > 0 or journalism_n > 0:
    content = json.dumps({
        'checked_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
        'savant_change_log_entries': savant_n,
        'completion_trigger_briefs': journalism_n,
        'note': 'auto-verified by verify-pending-checks.yml',
    })
    sql = '''INSERT INTO codex (key, category, title, content, status)
             VALUES (?, 'verification', ?, ?, 'open')
             ON CONFLICT(key) DO UPDATE SET content=excluded.content, updated_at=datetime('now')'''
    payload = json.dumps({
        'sql': sql,
        'params': [f'auto-verify-{\"$(date -u +%Y%m%d)\"}',
                   'Auto-verified: xERA pipeline and/or completion-triggered journalism confirmed live',
                   content],
    }).encode()
    req = urllib.request.Request(
        'https://field-relay-nba.jeffunglesbee.workers.dev/d1/execute',
        data=payload, method='POST',
        headers={'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026'},
    )
    urllib.request.urlopen(req)
    print('Logged to codex — condition newly confirmed.')
else:
    print('Neither condition met yet — no codex write, avoiding noise.')
"
```

**Verify the exact `codex` table's real column constraints** (is `key`
genuinely a `PRIMARY KEY` allowing `ON CONFLICT`? confirmed earlier this
session — `CREATE TABLE codex (key TEXT PRIMARY KEY, ...)` — yes) during
the probe step before trusting the upsert syntax above works as written.

## TASK 2: Verification

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/verify-pending-checks.yml'))"
```

Cannot fully verify end-to-end from the CC sandbox (needs a real
scheduled/dispatched run). Done condition: valid YAML, matches the real
`/d1/execute` auth header confirmed in probe.

**Chat-side follow-up (yes, genuinely one more manual step, but a
one-time one, not a recurring one):** trigger this workflow once via
`workflow_dispatch` to confirm it runs cleanly, then let the schedule
take over — this is the last manually-triggered check needed on this
specific pattern.

## TASK 3: Outbox manifest (last task)
