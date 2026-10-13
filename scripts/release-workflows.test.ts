import {expect, test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

interface CommandResult {
  exitCode: number;
  stdout: string;
}

const successExitCode = 0;
const failureExitCode = 1;
const fullGitShaLength = 40;
const publishWorkflow = new URL(
  '../.github/workflows/publish-release.yml',
  import.meta.url
);
const reviewedQuery = /'(?<script>flatten \| any[^'\n]+)'/u;
const checksQuery =
  /RUN=\$\(jq[^'\n]+'(?<script>[\s\S]*?)' "\$RUNNER_TEMP\/runs.json"\)/u;
const successQuery = /jq -e '(?<script>\.status[^'\n]+)'/u;
const pendingGuard = /(?<script>gh pr list --base[^\n]+\n {12}jq -e '[^'\n]+')/u;
const publicationFlags = / {10}RELEASE_FLAGS=(?<script>[\s\S]*?) {10}if git ls-remote/u;

function extract(pattern: Readonly<RegExp>, workflow: string): string {
  const match = pattern.exec(workflow);
  assert.ok(match);
  assert.ok(match.groups);
  const {script} = match.groups;
  assert.ok(typeof script === 'string' && script !== '');
  return script;
}

async function query(
  program: string,
  fixture: unknown,
  ...args: readonly string[]
): Promise<CommandResult> {
  const result = Bun.spawn(['jq', '-e', ...args, program], {
    stderr: 'pipe',
    stdin: new TextEncoder().encode(JSON.stringify(fixture)),
    stdout: 'pipe',
  });
  const [exitCode, stdout] = await Promise.all([
    result.exited,
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
  ]);
  return {exitCode, stdout};
}

test('publication requires the merged PR base, release head, and exact merge SHA', async () => {
  const program = extract(reviewedQuery, await readFile(publishWorkflow, 'utf8'));
  const pr = {
    base: {ref: 'feature/map-ui'},
    head: {ref: 'release/1.2.3-beta.map-ui.1'},
    merge_commit_sha: 'a'.repeat(fullGitShaLength),
    merged_at: '2026-01-01',
  };
  const args = [
    '--arg',
    'branch',
    pr.head.ref,
    '--arg',
    'target',
    pr.base.ref,
    '--arg',
    'sha',
    pr.merge_commit_sha,
  ];
  const accepted = await query(program, [[pr]], ...args);
  expect(accepted.exitCode).toBe(successExitCode);
  for (const changed of [
    {...pr, base: {ref: 'main'}},
    {...pr, head: {ref: 'feature/map-ui'}},
    {...pr, merge_commit_sha: 'b'.repeat(fullGitShaLength)},
    {base: pr.base, head: pr.head, merge_commit_sha: pr.merge_commit_sha},
  ]) {
    const rejected = await query(program, [[changed]], ...args);
    expect(rejected.exitCode).toBe(failureExitCode);
  }
});

test('publication selects only the exact branch and SHA push or manual runs', async () => {
  const program = extract(checksQuery, await readFile(publishWorkflow, 'utf8'));
  const run = {
    conclusion: 'success',
    created_at: '2026-01-01',
    event: 'push',
    head_branch: 'feature/map-ui',
    head_sha: 'a'.repeat(fullGitShaLength),
    id: 1,
    status: 'completed',
  };
  const unrelated = [
    {...run, head_branch: 'main', id: 2},
    {...run, head_sha: 'b'.repeat(fullGitShaLength), id: 3},
    {...run, event: 'pull_request', id: 4},
  ];
  const args = ['--arg', 'branch', run.head_branch, '--arg', 'sha', run.head_sha];
  const selectedPush = await query(
    program,
    {workflow_runs: [run, ...unrelated]},
    ...args
  );
  expect(JSON.parse(selectedPush.stdout)).toEqual(run);
  const manual = {
    ...run,
    conclusion: 'failure',
    created_at: '2026-01-02',
    event: 'workflow_dispatch',
    id: 5,
  };
  const selectedManual = await query(
    program,
    {workflow_runs: [run, manual, ...unrelated]},
    ...args
  );
  expect(JSON.parse(selectedManual.stdout)).toEqual(manual);
  expect(await query(program, {workflow_runs: unrelated}, ...args)).toMatchObject({
    exitCode: failureExitCode,
  });
});

test.each([
  ['false', '--prerelease=false\n'],
  ['true', '--prerelease=true\n--latest=false\n'],
])(
  'publication applies the derived prerelease value %s',
  async (prerelease, expected) => {
    const script = extract(publicationFlags, await readFile(publishWorkflow, 'utf8'));
    const result = Bun.spawn(['bash', '-eu'], {
      env: {...process.env, PRERELEASE: prerelease},
      stderr: 'pipe',
      stdin: new TextEncoder().encode(
        `RELEASE_FLAGS=${script}\nprintf '%s\n' "\${RELEASE_FLAGS[@]}"`
      ),
      stdout: 'pipe',
    });
    const [exitCode, stdout] = await Promise.all([
      result.exited,
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
    ]);
    expect(exitCode).toBe(successExitCode);
    expect(stdout).toBe(expected);
  }
);

test.each([
  ['main', '[]', successExitCode],
  ['feature/map-ui', '[{"headRefName":"release/1.2.3-alpha.map-ui.1"}]', failureExitCode],
] as const)(
  'pending release guard queries only target %s',
  async (target, pending, exitCode) => {
    const prepareWorkflow = new URL(
      '../.github/workflows/prepare-release.yml',
      import.meta.url
    );
    const guard = extract(pendingGuard, await readFile(prepareWorkflow, 'utf8'));
    const result = Bun.spawn(['bash', '-euo', 'pipefail'], {
      env: {...process.env, PENDING: pending, TARGET_BRANCH: target},
      stderr: 'pipe',
      stdin: new TextEncoder().encode(
        `gh() { [[ "$1 $2 $3 $4" == "pr list --base $TARGET_BRANCH" ]] || return 99; printf '%s\n' "$PENDING"; }\n${guard}`
      ),
      stdout: 'pipe',
    });
    const [actualExitCode] = await Promise.all([
      result.exited,
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
    ]);
    expect(actualExitCode).toBe(exitCode);
  }
);

test.each([
  ['failure', 'completed'],
  ['success', 'in_progress'],
])(
  'publication rejects a latest run with conclusion %s and status %s',
  async (conclusion, status) => {
    const program = extract(successQuery, await readFile(publishWorkflow, 'utf8'));
    const result = await query(program, {conclusion, status});
    expect(result.exitCode).toBe(failureExitCode);
  }
);
