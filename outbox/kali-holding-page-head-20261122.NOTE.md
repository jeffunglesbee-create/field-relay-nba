# kali-holding-page-head-20261122.html

The opening of the page `https://kaliaflstats.com/api/afl/v1/predictions?year=2026` answered with on 2026-11-22T23:35Z: HTTP 200, 5818 bytes
(`wc -c`), as the first 400 bytes that `probe-url.yml` prints (field-laboratory run 45084086791,
https://github.com/jeffunglesbee-create/field-laboratory/actions/runs/45084086791, job `probe`). The three Kali URLs it read
(`/predictions?year=2026`, `/teams`, `/fixture`) each logged the same opening. The rest of the page was not captured.

The log lines carry a timestamp and one separating space before each line of the page; those are removed here and nothing else is changed.
The excerpt stops mid-attribute at `href="https://kaliaflstats` because the probe prints 400 bytes.

`scripts/check-kali-nonjson-not-cached.mjs` reads this file as the opening of its holding-page fixture and asserts the fixture starts with it.
