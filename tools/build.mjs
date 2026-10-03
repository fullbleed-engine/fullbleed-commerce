// SPDX-License-Identifier: MIT
import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { wordpressEditorPlugin } from './wordpress-editor.mjs';
const destination = 'wordpress/fullbleed-commerce/assets/generated';
await mkdir(destination, { recursive: true });
const outputs = [];
outputs.push(await build({ entryPoints: ['src/admin.js'], bundle: true, outfile: `${destination}/admin.js`, format: 'iife', target: 'es2022', minify: false, legalComments: 'inline', metafile: true }));
outputs.push(await build({ entryPoints: ['src/editor-entry.js'], bundle: true, outfile: `${destination}/editor.js`, format: 'iife', target: 'es2022', minify: false, legalComments: 'inline', metafile: true, plugins: [await wordpressEditorPlugin()] }));
outputs.push(await build({ entryPoints: ['src/browser-worker.js'], bundle: true, outfile: `${destination}/worker.js`, format: 'iife', target: 'es2022', minify: false, legalComments: 'inline', metafile: true }));
const inputs = outputs.flatMap(output => Object.keys(output.metafile.inputs));
if (inputs.some(file => /(?:^|\/)node_modules\/(?:backbone|underscore|codemirror)\//.test(file) || /node_modules\/grapesjs\/dist\/grapes/.test(file))) throw new Error('The WordPress package must use core libraries, not bundle additional copies.');
await writeFile(`${destination}/editor.css`, await readFile('node_modules/grapesjs/dist/css/grapes.min.css', 'utf8') + '\n' + await readFile('src/template-editor.css', 'utf8'));
const packages = new Set(outputs.flatMap(output => Object.keys(output.metafile.inputs)).filter(file => file.startsWith('node_modules/')).map(file => file.split('/').slice(0, file.split('/')[1].startsWith('@') ? 3 : 2).join('/')));
packages.add('node_modules/grapesjs'); // Its source-map modules have a virtual esbuild namespace.
packages.add('node_modules/typescript'); // Retain attribution for emitted downlevel helpers.
async function packageNotice(path) {
  const pkg = JSON.parse(await readFile(`${path}/package.json`, 'utf8'));
  const licenseFiles = (await readdir(path)).filter(file => /^(?:licen[sc]e|copying|notice)(?:\.|$)/i.test(file));
  const texts = await Promise.all(licenseFiles.map(file => readFile(`${path}/${file}`, 'utf8')));
  if (!texts.length && pkg.name === '@bjorn3/browser_wasi_shim') texts.push(await readFile('LICENSES/MIT-WASI.txt', 'utf8'));
  if (!texts.length && pkg.name === 'backbone-undo') texts.push((await readFile(`${path}/README.md`, 'utf8')).split('## License (MIT License)')[1]);
  if (!texts.length && pkg.name === 'codemirror-formatting') texts.push(await readFile('LICENSES/MIT-CodeMirror-formatting.txt', 'utf8'));
  if (!texts.length || texts.some(text => !text?.trim())) throw new Error(`Retain license text for ${pkg.name} before distributing the editor.`);
  return `${pkg.name} ${pkg.version} (${pkg.license})\n${texts.join('\n')}`;
}
const notices = await Promise.all([...packages].sort().map(packageNotice));
notices.push(await readFile('LICENSES/MIT-Spectrum.txt', 'utf8'));
notices.push(await readFile('LICENSES/MIT-Cash.txt', 'utf8'));
await writeFile(`${destination}/EDITOR-THIRD-PARTY-NOTICES.txt`, notices.join('\n\n--------------------\n\n'));
if (!process.argv.includes('--base-only')) await build({ entryPoints: ['pro/admin.js'], bundle: true, outfile: 'wordpress/fullbleed-commerce-pro/assets/admin.js', format: 'iife', target: 'es2022', minify: false, legalComments: 'inline' });
await cp('node_modules/fullbleed/dist/engine.wasm', `${destination}/engine.wasm`);
await cp('node_modules/fullbleed/assets/fonts', `${destination}/fonts`, { recursive: true });
if (!process.argv.includes('--base-only')) {
  await mkdir('shopify/app/public/fonts', { recursive: true });
  await cp('node_modules/fullbleed/assets/fonts', 'shopify/app/public/fonts', { recursive: true });
  // Shopify still consumes the upstream standalone GrapesJS distribution.
  const standaloneNotices = await Promise.all(['backbone', 'underscore', 'codemirror'].map(name => packageNotice(`node_modules/${name}`)));
  await writeFile('shopify/app/public/EDITOR-THIRD-PARTY-NOTICES.txt', [...notices, ...standaloneNotices].join('\n\n--------------------\n\n'));
}
await cp('node_modules/fullbleed/dist/THIRD_PARTY_NOTICES.txt', `${destination}/THIRD_PARTY_NOTICES.txt`);
await cp('node_modules/fullbleed/dist/build.json', `${destination}/engine-build.json`);
await cp('LICENSES/MIT-WASI.txt', `${destination}/WASI-LICENSE.txt`);
await cp('LICENSES/MIT-Fullbleed.txt', `${destination}/FULLBLEED-LICENSE.txt`);
if (!process.argv.includes('--base-only')) await cp('LICENSES/MIT-fflate.txt', 'wordpress/fullbleed-commerce-pro/assets/FFLATE-LICENSE.txt');
const report = {};
for (const file of ['admin.js', 'editor.js', 'editor.css', 'worker.js', 'engine.wasm']) {
  const bytes = await readFile(`${destination}/${file}`);
  report[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(`${destination}/build.json`, JSON.stringify({ engine: '2.5.5', nodePackage: '0.1.1', wordpressCoreScripts: ['jquery', 'backbone', 'underscore', 'wp-codemirror'], grapesjsSourceMapSha256: createHash('sha256').update(await readFile('node_modules/grapesjs/dist/grapes.mjs.map')).digest('hex'), files: report }, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
