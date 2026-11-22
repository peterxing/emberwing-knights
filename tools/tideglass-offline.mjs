import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'https://peterxing.github.io/emberwing-knights/';
const result = await build({
  configFile: false, root, publicDir: false, logLevel: 'error',
  plugins: [{
    name: 'portable-map-only',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === './stage.js' && importer?.endsWith('/tideglass/game.js')) return '\0no-stage';
    },
    load(id) {
      if (id === '\0no-stage') return "export function createStage(){throw Error('3D is available in the online edition.')}";
    },
  }],
  build: {
    write: false, lib: { entry: join(root, 'src/tideglass/game.js'), name: 'Tideglass', formats: ['iife'] },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(x => x.output).filter(x => x.type === 'chunk');
if (outputs.length !== 1 || outputs[0].code.length > 120_000) throw Error('Expected one small offline rules/UI bundle.');
let html = await readFile(join(root, 'tideglass/index.html'), 'utf8');
const css = await readFile(join(root, 'src/tideglass/game.css'), 'utf8');
html = html.replace('<html lang="en">', '<html lang="en" data-edition="portable">')
  .replace('<title>The First Signal', '<title>The First Signal (offline)')
  .replace('<link rel="stylesheet" href="../src/tideglass/game.css">', () => `<style>${css}</style>`)
  .replace(/<script type="module" src="[^"]+"><\/script>/, () => `<script>${outputs[0].code.replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace(/\s*<a id="offline-link"[^>]*>[^<]*<\/a>/, '')
  .replaceAll('href="../"', `href="${url}"`)
  .replaceAll('href="./downloads/', `href="${url}tideglass/downloads/`);
for (const name of ['court', 'iria', 'drake']) {
  const image = await readFile(join(root, `tideglass/art/${name}.webp`));
  html = html.replace(`src="./art/${name}.webp"`, () => `src="data:image/webp;base64,${image.toString('base64')}"`);
}
if (/<script[^>]+\bsrc=|<link[^>]+\brel="stylesheet"|<img[^>]+\bsrc="(?!data:)/i.test(html))
  throw Error('The standalone edition still needs external runtime files.');
const file = join(root, 'dist/tideglass/downloads/The-First-Signal.html');
await mkdir(dirname(file), { recursive: true }); await writeFile(file, html);
console.log(`Tideglass portable map: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB, self-contained.`);
