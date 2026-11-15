import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
const result = await build({
  entryPoints: [fileURLToPath(new URL('./main.js', import.meta.url))],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  loader: {'.geojson': 'json'},
  define: {'process.env.NODE_ENV': '"production"'},
  legalComments: 'eof',
});
const template = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
const html = template
  .replace('STYLE', () => css)
  .replace('SCRIPT', () => result.outputFiles[0].text);
await mkdir(new URL('./dist/', import.meta.url), {recursive: true});
await writeFile(new URL('./dist/index.html', import.meta.url), html);
console.log(
  'Built standalone prototype: ' +
    fileURLToPath(new URL('./dist/index.html', import.meta.url))
);
