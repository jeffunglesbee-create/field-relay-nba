#!/usr/bin/env node
// Drives scripts/relay-look.sh end to end against a FAKE `gh` (a bash shim on PATH that answers from files) and a local git remote, with every wait shortened. The
// independent review of 2026-11-01 found the first version of the helper dying on a dirty working tree (it ran `git pull --rebase`), dying on one transient gh failure,
// and ending with "committed no artifact" and no run URL when the run had failed; each is a scenario here, and scripts/mutate-relay-look.mjs puts each defect back.
//
// COVERAGE: the helper's own logic (dispatch retry, finding its run by title among decoys, tolerating a failed poll, fetching without touching the tree, the messages on failure).
// It does NOT reach GitHub: whether `run-name` drives `display_title` and whether a boolean-free dispatch is accepted are proved only by the first real run (docs/relay-from-the-sandbox.md).
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HELPER = path.resolve('scripts/relay-look.sh');
const REPO = 'jeffunglesbee-create/field-relay-nba';
let bad = 0, total = 0;
const one = (label, got, want) => { total++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const GH = `#!/usr/bin/env bash
# fake gh: state in $FAKE (files: dispatch_fail_n, label, runs_polls_fail_at, status_seq, conclusion, calls)
echo "$@" >> "$FAKE/calls"
args="$*"
case "$args" in
  *"/dispatches"*)
    n=$(cat "$FAKE/dispatch_fail_n" 2>/dev/null || echo 0)
    if [ "$n" -gt 0 ]; then echo $((n-1)) > "$FAKE/dispatch_fail_n"; echo "HTTP 422: Workflow does not have 'workflow_dispatch' trigger" >&2; exit 1; fi
    for a in "$@"; do case "$a" in inputs\\[label\\]=*) echo "\${a#inputs\\[label\\]=}" > "$FAKE/label";; esac; done
    exit 0 ;;
  *"/runs?event=workflow_dispatch"*)
    label=$(cat "$FAKE/label" 2>/dev/null || echo none)
    # a decoy run (someone else's, NEWER than ours) must not be picked
    json="{\\"workflow_runs\\":[{\\"id\\":999,\\"display_title\\":\\"relay-read other\\",\\"created_at\\":\\"2099-01-01T00:00:00Z\\"},{\\"id\\":777,\\"display_title\\":\\"relay-read $label\\",\\"created_at\\":\\"2099-01-01T00:00:00Z\\"}]}"
    jqf=""; while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jqf="$2"; shift; done
    echo "$json" | jq -r "$jqf" ; exit $? ;;
  *"/actions/runs/777"*)
    k=$(cat "$FAKE/polls" 2>/dev/null || echo 0); k=$((k+1)); echo $k > "$FAKE/polls"
    if [ "$k" = "$(cat "$FAKE/poll_fail_at" 2>/dev/null || echo -1)" ]; then echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1; fi
    seq=$(cat "$FAKE/status_seq")
    if [ "$k" -ge "$(cat "$FAKE/done_at" 2>/dev/null || echo 2)" ] && [ "$seq" != "never" ]; then echo "completed/$(cat "$FAKE/conclusion")"; else echo "in_progress/"; fi
    exit 0 ;;
esac
echo "fake gh: unexpected call: $args" >&2; exit 1
`;

function scenario(opts) {
  // the shim's dispatch step commits the artifact to the remote, which is the part the real runner does
  const root = mkdtempSync(path.join(tmpdir(), 'relay-look-'));
  const fake = path.join(root, 'fake'); mkdirSync(fake);
  const bin = path.join(root, 'bin'); mkdirSync(bin);
  const remote = path.join(root, 'field-relay-nba.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const artifactScript = path.join(root, 'commit-artifact.sh');
  writeFileSync(artifactScript, `#!/usr/bin/env bash
set -e
label="$1"; d=$(mktemp -d); git clone -q "${remote}" "$d/r"; cd "$d/r"; mkdir -p outbox
cat > "outbox/relay-read-$label-20261101T120000Z.json" <<EOF
{"label":"$label","summary":{"requested":2,"read_ok":${opts.refused ? 1 : 2},"refused":${opts.refused ? 1 : 0},"failed":0},"entries":[{"route":"/health","status":200,"ok":true,"ms":12,"bytes":20,"truncated":false,"body":{"ok":true}},${opts.refused ? '{"route":"/v2/games","refused":true,"why":"not on the allow-list"}' : '{"route":"/budget/odds","status":200,"ok":true,"ms":30,"bytes":99,"truncated":false,"body":{"daily":{"used":5}}}'}]}
EOF
git add -A; git -c user.email=t@t -c user.name=t commit -q -m "chore: relay read"; git push -q origin HEAD:main
`);
  chmodSync(artifactScript, 0o755);
  const gh = GH.replace('    exit 0 ;;\n  *"/runs?event', `    ${opts.artifact ? `bash "${artifactScript}" "$(cat "$FAKE/label")" >/dev/null 2>&1` : ':'}\n    exit 0 ;;\n  *"/runs?event`);
  writeFileSync(path.join(bin, 'gh'), gh); chmodSync(path.join(bin, 'gh'), 0o755);
  writeFileSync(path.join(fake, 'dispatch_fail_n'), String(opts.dispatchFail || 0));
  writeFileSync(path.join(fake, 'conclusion'), opts.conclusion || 'success');
  writeFileSync(path.join(fake, 'status_seq'), opts.never ? 'never' : 'ok');
  if (opts.pollFailAt) writeFileSync(path.join(fake, 'poll_fail_at'), String(opts.pollFailAt));
  const work = path.join(root, 'field-relay-nba'); execFileSync('git', ['clone', '-q', remote, work], { stdio: 'ignore' });
  const git = (...a) => execFileSync('git', ['-C', work, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' }).toString();
  mkdirSync(path.join(work, 'outbox')); writeFileSync(path.join(work, 'README'), 'one\n'); git('add', '-A'); git('commit', '-q', '-m', 'init'); git('push', '-q', 'origin', 'HEAD:main');
  if (opts.dirty) { writeFileSync(path.join(work, 'README'), 'two\n'); writeFileSync(path.join(work, 'staged.txt'), 'x\n'); git('add', 'staged.txt'); }
  if (opts.unpushed) { writeFileSync(path.join(work, 'mine.txt'), 'm\n'); git('add', '-A'); git('commit', '-q', '-m', 'local work'); }
  const headBefore = git('rev-parse', 'HEAD').trim();
  const statusBefore = git('status', '--porcelain');
  const child = spawnSync('bash', [HELPER, '/health', '/budget/odds'], { cwd: work, encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE: fake, RELAY_LOOK_NAP: '0.05' } });
  return { root, work, git, headBefore, statusBefore, child, fake, out: child.stdout, err: child.stderr };
}

const cleanup = [];
{
  const s = scenario({ artifact: true }); cleanup.push(s.root);
  one('happy path: exit 0, prints both routes with status and body', [s.child.status, /\/health\s+->\s+HTTP 200/.test(s.out), /\/budget\/odds\s+->\s+HTTP 200/.test(s.out), /"used":5/.test(s.out)], [0, true, true, true]);
  one('...picked its own run (777) over a newer decoy run (999)', /run 777:/.test(s.err), true);
  one('...says how to read the whole file', /git show FETCH_HEAD:outbox\/relay-read-look/.test(s.err), true);
}
{
  const s = scenario({ artifact: true, dirty: true, unpushed: true }); cleanup.push(s.root);
  one('a dirty working tree and an unpushed commit do not stop it: exit 0', s.child.status, 0);
  one('...and it touched neither: same HEAD, same working-tree status', [s.git('rev-parse', 'HEAD').trim() === s.headBefore, s.git('status', '--porcelain') === s.statusBefore], [true, true]);
}
{
  const s = scenario({ artifact: true, pollFailAt: 1 }); cleanup.push(s.root);
  one('one failed poll (HTTP 502) is retried, not fatal: exit 0', s.child.status, 0);
}
{
  const s = scenario({ artifact: true, dispatchFail: 2 }); cleanup.push(s.root);
  one('a dispatch that answers 422 twice is retried: exit 0, and the failures were reported', [s.child.status, (s.err.match(/dispatch attempt \d of 3 failed/g) || []).length], [0, 2]);
}
{
  const s = scenario({ artifact: true, dispatchFail: 3 }); cleanup.push(s.root);
  one('a dispatch that never works: exit 1 and says so', [s.child.status, /could not dispatch/.test(s.err)], [1, true]);
}
{
  const s = scenario({ artifact: true, never: true }); cleanup.push(s.root);
  one('a run that never completes: exit 1, says it is still going, and gives the label and the run URL', [s.child.status, /still going/.test(s.err), /still going[^\n]*actions\/runs\/777/.test(s.err), /still going[^\n]*label look\d+/.test(s.err)], [1, true, true, true]);
}
{
  const s = scenario({ artifact: false, conclusion: 'failure' }); cleanup.push(s.root);
  one('a run that failed before writing anything: exit 1, no "finished" lie, the run URL and the self-test hint are given', [s.child.status, /committed no artifact/.test(s.err), /committed no artifact[^\n]*actions\/runs\/777/.test(s.err), /committed no artifact[^\n]*self-test/.test(s.err)], [1, true, true, true]);
}
{
  const s = scenario({ artifact: true, refused: true, conclusion: 'failure' }); cleanup.push(s.root);
  one('a red run WITH an artifact prints it (the refusal is the finding) and still exits 1', [s.child.status, /REFUSED \/v2\/games/.test(s.out), /not on the allow-list/.test(s.out)], [1, true, true]);
}
for (const r of cleanup) rmSync(r, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : `\ncheck-relay-look: ${total}/${total}`);
console.log('COVERAGE: scripts/relay-look.sh against a fake gh and a local git remote. It does NOT reach GitHub.');
process.exit(bad ? 1 : 0);
