# No workflow may install a credential from a literal

**2026-08-25.** The guard for the one defect from today that had none.

## The file it exists for

`.github/workflows/update-odds-key.yml`, deleted this morning:

```yaml
name: Set ODDS_API_KEY to 20K plan key
    name: Set ODDS_API_KEY to 20K plan key
      - name: Update ODDS_API_KEY to 20K plan
        run: |
          echo "<a 32-hex literal>" | wrangler secret put ODDS_API_KEY --name field-relay-nba
          echo "✅ ODDS_API_KEY updated to 20K plan key"
```

The literal was the **exhausted** free-tier key. One `workflow_dispatch` would
have replaced the working production key with a dead one and printed a green
checkmark saying it had installed the 20K plan key. The workflow name, the job
name, the step name and the success message all said one thing; the value said
another.

## The rule I did not write, and why

The obvious guard is "a step's name must match what it does". **It was measured
before it was written.** Over 828 steps in three repositories, a rule requiring
every number and ALL-CAPS token in a step name to appear in that step's body
produced **73 hits**, essentially all of them:

- section labels — `STRUCTURAL 2 — NBA whitelist`, `PROBE A — NBA CDN`, `COURIER`, `BOOTSTRAP`
- subject nouns — `Probe ESPN broadcast shape`, `UEFA competitions`, `Get GitHub OIDC token`
- constants living in a script rather than inline — `slate caps resolve against SCALE`

A check with that signal-to-noise gets deleted, and a deleted check guards
nothing. So it is not here. Measuring first is the same discipline that set the
citation budget and the census bands, applied to a check that then did not ship.

## The rule I did write

The **mechanism** rather than the claim: a command that installs a secret must
take its value from a variable or a `secrets.*` expression, never a quoted
literal. There is no judgement in it, and it holds whether or not the name above
it lies — a literal cannot be rotated, cannot be audited, and is in git history
the moment it is written.

Covered installers: `wrangler secret put`, `gh secret set`, `fly secrets set`,
`vercel env add`. Accepted sources: `$VAR`, `${VAR}`, `${{ ... }}`, a file
redirect, `--body-file`.

Ten self-test cases, six of them asserting a legitimate shape is **not** flagged
— a false positive here fails a deploy, so the allowed forms are the larger half
of the test.

## Teeth, demonstrated

The deleted file was restored from `0607526^` and the check run against it:

```
91 workflow(s) scanned
FAIL  no workflow installs a credential from a literal
      → .github/workflows/update-odds-key.yml:19 — wrangler secret put with a 32-character literal
```

Exit 1. It names the file, the line and the literal's **length** — never its
value.

## All four repos, first time

| repo | workflows | result | wired into |
|---|---|---|---|
| field-relay-nba | 90 | clean | `deploy.yml` |
| jubilant-bassoon | 118 | clean | `smoke-and-verify.yml` |
| field-laboratory | 13 | clean | `verify.yml` |
| field-playground | 80 | clean | `build-check.yml` |

**301 workflows, one offender, and it was already deleted.** Ported to all four
in the same change rather than to one and reported as "the exposure" — the
lesson the secret scanner taught eight hours earlier, applied before it could
recur.

This is also **field-playground's first gate.** It had none, which
`docs/CC-CMD-2026-08-25-playground-secret-gate.md` filed as the last of the four
unguarded. That CC-CMD stays open: the secret ratchet and citation check are
still owed there, and its step 3 says measure the counts rather than copy them.
