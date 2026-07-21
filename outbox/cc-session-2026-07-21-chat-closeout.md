# Chat Session Doc — 2026-07-21 — closeout

## Session Type
Chat session (not CC-CMD). No src/ commits. Documentation close-out + research.

## HEAD Progression

| Commit | Message |
|--------|---------|
| 561ab98 | docs: update outbox + HANDOFF — verify job confirmed passing [skip ci] |

## What Happened

This session was the tail-end close-out of the verify-job-deploy CC session.

**Commit 561ab98** — pushed the outbox doc and HANDOFF update that had been written but
not yet committed when the prior context window expired. The update reflected the final
verified state: run 29843677043 (`workflow_dispatch`, 2026-07-21T15:22:38Z, HEAD
`8379f69`) passed with `success` — all 9 probe steps green, both `deploy` and `verify`
jobs completed. Also updated the confidence-gate-acknowledged entry and carry-forward
note about the GitHub Support ticket.

A push conflict was encountered (remote had `fe50b17` — the auto-committed live-verify
outbox file from the verify job itself). Resolved via `git pull --rebase && git push`.

## Research Conducted

Jeff asked about Google Vertex AI. A deep research workflow was run (104 agents, 22
sources fetched, 25 claims adversarially verified). Key findings documented in chat:

- Vertex AI = enterprise GCP service; AI Studio = developer portal (Google Account,
  static API key, free tier, Google models only)
- Model Garden: 200+ models including Anthropic Claude, Meta Llama, Mistral, AI21
- Gemini 2.5 Pro: $1.25/1M input, $10/1M output
- Gemini 3.6 Flash (launched 2026-07-21): $1.50/1M input, $7.50/1M output
- Batch API: 50% discount, paid tier only
- Auth: IAM service accounts + short-lived OAuth tokens (1hr default); OpenAI SDK
  compatible via base URL substitution
- Non-global endpoints: ~10% premium (formal effect 2026-07-01 for Gemini 3+ GA)
- Key differentiator: Vertex AI data never used to train Google models; AI Studio
  free tier is

This research was informational only — no relay or client code was affected.

## Carry-Forwards

- Cancel GitHub Support ticket for workflow ID 317109373 (post-deploy-verify.yml) if
  it was opened. Root cause was YAML syntax error (heredoc at column 1), not a
  GitHub-side registry freeze. The fix (embed verify job in deploy.yml) is live and
  verified. The ticket is likely unnecessary.
- No code carry-forwards. Verify job is running end-to-end. System is clean.

## Integration Status

Verify job: **VERIFIED** — Run 29843677043, HEAD 8379f69, all 9 probes passed.
No staged features from this session.
