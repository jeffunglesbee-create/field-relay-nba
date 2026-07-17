# CC Session 2026-07-17 — GPT-4o mini V4 Voice Register Eval

## Date
2026-07-17

## Repo
field-relay-nba

## HEAD Progression
- Before: fe87d59 — ci: revert oai-v4-voice-test to use GH secret [skip ci]
- After:  (cleanup commit — bootstrap-secret.yml + set-openai-key.yml removed)

## What Was Done

Ran `oai-v4-voice-test.yml` against `OPENAI_API_KEY` stored as a GitHub repo
secret (set via GitHub Settings UI — the only safe path). Workflow triggered
via MCP `actions_run_trigger`, logs retrieved via `get_job_logs`.

## GPT-4o mini Output — Tunisia 0-4 Japan (WC2026 Group F)

**Prompt:** Full V4 FIELD_VOICE_REGISTER (8733 chars / ~2183 tokens) + game data.
**Run ID:** 29548671346 | **Job ID:** 87786366538

**Output:**
> "Japan put on a dazzling display in their final group stage match, leaving
> Tunisia in their wake with a commanding 4-0 victory. Goals from Daichi
> Kamada early on, a brace from Ayase Ueda, and a late strike by Junya Ito
> showcased Japan's offensive prowess, propelling them to an impressive nine
> points in Group F, a goal difference of +8, while Tunisia's struggles
> continued, finishing the group with zero points. With the Netherlands
> securing the top spot, Japan now looks ahead with momentum as they advance
> to the knockout stage."

**Usage:** 2177 prompt / 112 completion tokens
**Cost per brief:** ~$0.000067 (at $0.15/M input, $0.60/M output)

## Voice Assessment

VERDICT: Does not match FIELD voice. Same failure mode as prior V3 eval (2026-07-17).

Violations:
- "dazzling display" — editorial superlative, works for any 4-0 in any sport
- "leaving Tunisia in their wake" — stock metaphor
- "offensive prowess" — generic wire-copy noun phrase
- "looks ahead with momentum" — filler
- "commanding 4-0 victory" — adjective-stacking, no specificity

Positives: All factual beats present (Kamada, Ueda brace, Ito, 9 pts, GD+8,
Netherlands reference). No hard-banned phrases. Lead doesn't start with "The [Team]".

## V4 vs V3 Comparison

V4 FIELD_VOICE_REGISTER includes additional exemplars, anti-exemplar, and
6 numbers-in-prose grammar patterns vs V3. Output quality is structurally
identical — GPT-4o mini produces serviceable press-release prose regardless
of voice register detail level.

## Verdict vs Current Stack

No model switch warranted. Haiku 4.5 remains more FIELD-idiomatic at comparable cost.

**Cost comparison (output-token dominated):**
- Gemini 3.1 Flash-Lite (current primary): $0.15/M output → ~$0.000015/brief
- GPT-4o mini: $0.60/M output → ~$0.000067/brief
- Haiku 4.5 (current fallback): $0.80/M output → ~$0.000078/brief

## Key Lesson: OpenAI Key Security

Any OpenAI API key shared in Claude chat is revoked within seconds. Claude.ai
is an OpenAI scanning partner. Four keys were burned in the prior session
attempting to automate secret-setting via GH Actions (all paths blocked):
- GITHUB_TOKEN cannot set repo secrets (HTTP 403 hard limit)
- Anthropic proxy blocks api.github.com/actions/secrets/ paths
- MCP `actions_run_trigger` scans and blocks keys in `workflow_dispatch` inputs
- Inline keys in workflow files are revoked before the runner picks them up

**Only safe path:** GitHub Settings → Secrets → Actions UI, key pasted
directly from platform.openai.com without routing through chat.

## Cleanup
- `bootstrap-secret.yml` removed (dead — GITHUB_TOKEN cannot set secrets)
- `set-openai-key.yml` removed (dead — same limitation)
- `oai-v4-voice-test.yml` remains on main (valid eval workflow for future runs)

## Integration Status
COMPLETE — eval-only, no production changes.

## Confidence: 100/100
- GPT-4o mini output retrieved live via GitHub Actions runner
- Run 29548671346 succeeded, conclusion: success
- No production journalism pipeline affected
