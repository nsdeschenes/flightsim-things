import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const directory = new URL(
  '../packages/interface/src/prototypes/tanstack-scenery/',
  import.meta.url
);
if (!existsSync(new URL('node_modules/esbuild', directory))) {
  const install = spawnSync('npm', ['ci', '--ignore-scripts'], {
    cwd: fileURLToPath(directory),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}
const build = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('build.mjs', directory))],
  {stdio: 'inherit'}
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}
const page = await readFile(new URL('dist/index.html', directory));
createServer((_request, response) => {
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end(page);
}).listen(5180, '127.0.0.1', () =>
  console.log('Scenery prototype: http://127.0.0.1:5180/?variant=overview')
);
