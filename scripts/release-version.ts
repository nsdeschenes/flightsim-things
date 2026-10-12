import assert from 'node:assert/strict';

const successExitCode = 0;
const completeMatchIndex = 0;
const releaseVersionPattern =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:alpha|beta|rc)(?:\.(?:[a-z][a-z0-9-]*))?\.(?:0|[1-9][0-9]*))?$/u;

type ReleaseVersion =
  | Readonly<{kind: 'stable'; value: string}>
  | Readonly<{kind: 'prerelease'; value: string}>;
type ReleaseIdentity =
  | Readonly<{
      version: Extract<ReleaseVersion, {kind: 'stable'}>;
      targetBranch: 'main';
    }>
  | Readonly<{
      version: Extract<ReleaseVersion, {kind: 'prerelease'}>;
      targetBranch: string;
    }>;

function parseReleaseVersion(input: string): ReleaseVersion {
  const match = releaseVersionPattern.exec(input);
  assert.ok(
    match && match.at(completeMatchIndex) === input,
    `Expected X.Y.Z or X.Y.Z-(alpha|beta|rc)[.track].N without v, received ${input}`
  );
  if (input.includes('-')) {
    return {kind: 'prerelease', value: input};
  }
  return {kind: 'stable', value: input};
}

async function validateBranch(targetBranch: string): Promise<void> {
  assert.ok(!targetBranch.startsWith('release/'), 'release/ is reserved for release PRs');
  const child = Bun.spawn(['git', 'check-ref-format', `refs/heads/${targetBranch}`], {
    stderr: 'ignore',
    stdout: 'ignore',
  });
  assert.equal(await child.exited, successExitCode, 'Invalid target branch');
}

async function parseReleaseIdentity(
  input: string,
  targetBranch: string
): Promise<ReleaseIdentity> {
  const parsed = parseReleaseVersion(input);
  await validateBranch(targetBranch);
  if (parsed.kind === 'stable') {
    assert.equal(targetBranch, 'main', 'Stable releases require target branch main');
    return {targetBranch, version: parsed};
  }
  return {targetBranch, version: parsed};
}

const releaseVersions = {parseReleaseIdentity, parseReleaseVersion, validateBranch};
export default releaseVersions;
