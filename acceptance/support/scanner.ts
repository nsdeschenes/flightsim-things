import {Database} from 'bun:sqlite';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createCliFixture from './cli.ts';

type CommandResult = Readonly<{exitCode: number; stderr: string; stdout: string}>;
type Fixture = Readonly<{
  addon: (
    name: string,
    files: Readonly<Record<string, string>>,
    contentType?: string
  ) => Promise<string>;
  community: string;
  dispose: () => Promise<void>;
  home: string;
  query: (sql: string) => unknown[];
  run: (...args: readonly string[]) => Promise<CommandResult>;
}>;
async function writeAddon(
  root: string,
  files: Readonly<Record<string, string>>,
  contentType: string
): Promise<string> {
  await mkdir(root, {recursive: true});
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      content_type: contentType,
      creator: 'Fixture',
      package_version: '1.0',
      title: path.basename(root),
    })
  );
  await writeFile(
    path.join(root, 'layout.json'),
    JSON.stringify({
      content: Object.keys(files).map(filename => ({
        path: filename.replaceAll('/', '\\'),
      })),
    })
  );
  for (const [filename, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, filename)), {recursive: true});
    await writeFile(path.join(root, filename), contents);
  }

  return root;
}

function query(home: string, sql: string): unknown[] {
  using db = new Database(path.join(home, '.flightsim-things/addons.sqlite'), {
    readonly: true,
  });
  return db.query(sql).all();
}

async function createFixture(): Promise<Fixture> {
  const cli = await createCliFixture();
  const {home} = cli;
  const community = path.join(home, 'Community');
  await mkdir(community);
  return {
    addon: async (name, files, contentType = 'MISC') => {
      const root = await writeAddon(path.join(community, name), files, contentType);
      return root;
    },
    community,
    dispose: cli.dispose,
    home,
    query: sql => query(home, sql),
    run: cli.run,
  };
}

export default createFixture;
