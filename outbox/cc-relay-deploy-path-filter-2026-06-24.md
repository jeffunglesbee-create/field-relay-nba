# relay deploy.yml — Path Filter (2026-06-24)

## What shipped

- `.github/workflows/deploy.yml` — added `paths:` filter to `push` trigger

## Change

**Before:**
```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
```

**After:**
```yaml
on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'wrangler.toml'
      - 'workers/**'
  workflow_dispatch:
```

## Why

Every commit to field-relay-nba (including [skip ci] outbox manifests, CC-CMD
docs, HANDOFF.md updates) previously triggered the full deploy chain:
- KV Bootstrap × 3 namespaces
- wrangler deploy + health gate
- Bracket refresh
- Courier Worker deploy
- Claude Proxy deploy + AI Gateway secrets sync
- 15s propagation + 7 structural checks + 6 upstream probes + 3 Courier checks
~4-6 min CI run. Unnecessary for docs/outbox changes that touch no code.

## Cascading effect

Outbox manifest commits no longer need [skip ci]. drive-upload-outbox.yml
is path-filtered to outbox/**/*.md and fires automatically on manifest pushes.
Manual workflow_dispatch preserved for forced deploys.

## Verification

Commit 02f4a85 pushed (workflow-only change, no src/ changes).
Deploy workflow run list shows latest as 5b2ea9e — 02f4a85 did NOT trigger
a deploy. Path filter confirmed working.

## Commit

02f4a85 — ci: path-filter relay deploy.yml — exclude docs/ outbox/ from deploy trigger
