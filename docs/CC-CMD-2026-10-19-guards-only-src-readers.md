# Claude Code Command — six src-reading guards do not stop a deploy

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; do not create a feature branch or a PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** CC, from the 2026-10-19 adversarial review of
`docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md`. That CC-CMD moved
the twelve odds guards onto the deploy path. These six are outside its scope
(Rule 69). This is Rule 87.4's second CC-CMD for them.

---

## What was measured, 2026-10-19

`guards.yml` has `paths-ignore: src/**`, and it is a separate workflow from
`deploy.yml`. So a guard that reads `src/` and runs only in `guards.yml` never
runs on a src-only push, and `deploy.yml` deploys without it. The census:

```
python3 - <<'EOF'
import yaml,re,os
g=yaml.safe_load(open('.github/workflows/guards.yml'))
d=open('.github/workflows/deploy.yml').read()
for j in g['jobs'].values():
    for st in j['steps']:
        r=st.get('run') or ''
        scripts=sorted(set(re.findall(r'scripts/[\w./-]+\.(?:mjs|js|sh|py|cjs)',r)))
        reads=[s for s in scripts if os.path.exists(s) and re.search(r"['\"`(]\.?\.?/?src/|readFileSync\([^)]*src", open(s,errors='ignore').read())]
        if reads and any(s not in d for s in scripts): print(st.get('name'))
EOF
```

At `f4b4e5eb` it printed nine steps. Three are odds guards, and they were
copied into `deploy.yml` by the odds-gate CC-CMD:
- `check-wc-lambdas-gated`;
- `check-reconcile-tally`;
- `check-script-created-tables`.

The six left are:

| guards.yml step | scripts not in deploy.yml | note |
|---|---|---|
| the relay's gates read the secret from env and fail closed | check-relay-secret-gates.mjs | security-relevant: a src-only push could reintroduce a hardcoded secret gate |
| no out-of-scope vendor is back in the relay | check-no-foreign-domain.mjs | |
| a route claims no host from a function it does not call | mutate-provenance-shadowing.mjs | the step runs only this mutation script; TASK 0 must find which check it exercises and whether that check is in deploy.yml |
| The on-ice reconstruction still refuses what contradicts situationCode | check-nhl-onice.mjs, nhl-shiftcharts-probe.mjs | read the probe for network use before copying |
| The hockey WP scorer still refuses what it cannot read | check-hockey-wp.mjs and four companions | read the probe and train scripts for network use before copying |
| every BSD frame the contract declares matches the captures | check-bsd-frame-contract.mjs, mutate-bsd-frame-contract.mjs | its live part fetches a list (HTTP 0 in the sandbox, green on the runner); decide whether the deploy should depend on that host |

## TASK 0 — probe each before copying (Rule 100)

1. Re-run the census at HEAD; the list may have changed.
2. For each step:
   - run it offline in a fresh committed copy, and record its rc and its
     time;
   - grep its scripts for `fetch(`, `curl`, `https://` and `git ` (any network
     or git-history use).
3. Run `node scripts/mutate-deploy-odds-wrappers.mjs` once as the reference
   for the harness pattern.

## TASK 1 — the choice

- **Recommended:** copy each step that runs offline and fast into
  `deploy.yml` before "Deploy to Cloudflare Workers", verbatim, as the
  odds-gate CC-CMD did. Put the security one (relay secret gates) first.
- A step that needs network: decide per step whether the deploy should wait
  on that host. Do not copy it silently.
- Then update the `guards.yml` header, which counts "six other src-reading
  guards".

## Done condition (Rule 89 artifacts)

1. The census prints only the steps TASK 1 deliberately left out, each with
   its reason written beside it in `guards.yml`.
2. For each copied guard, one mutant of the `src/` file it reads turns a
   `deploy.yml` step red. Show this with a mutation run, anchors asserted
   unique, and commit the log.
3. One green `deploy.yml` run on the commit, with its run id recorded.

## FORBIDDEN

- No change to `src/` behaviour.
- Do not loosen any guard to make it fit the deploy path.
