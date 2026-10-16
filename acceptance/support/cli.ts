import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

type CommandResult = Readonly<{exitCode: number; stderr: string; stdout: string}>;
type CliFixture = Readonly<{
  home: string;
  configurationFile: string;
  run: (...args: readonly string[]) => Promise<CommandResult>;
  dispose: () => Promise<void>;
}>;
const repository = fileURLToPath(new URL('../..', import.meta.url));
const entrypoint = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

async function createCliFixture(): Promise<CliFixture> {
  const home = await mkdtemp(path.join(tmpdir(), 'flightsim-acceptance-'));
  const binary = process.env.FLIGHTSIM_TEST_BINARY;
  let executable = [process.execPath, entrypoint];
  if (typeof binary === 'string' && binary !== '') {
    executable = [path.resolve(repository, binary)];
  }

  return {
    configurationFile: path.join(home, '.flightsim-things/config.json'),
    dispose: async () => {
      await rm(home, {force: true, recursive: true});
    },
    home,
    run: async (...args) => {
      const child = Bun.spawn([...executable, ...args], {
        cwd: home,
        env: {...process.env, HOME: home, USERPROFILE: home},
        stderr: 'pipe',
        stdout: 'pipe',
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return {exitCode, stderr, stdout};
    },
  };
}

export default createCliFixture;
