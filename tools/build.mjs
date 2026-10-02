// SPDX-License-Identifier: MIT
import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const destination = 'wordpress/fullbleed-commerce/assets/generated';
await mkdir(destination, { recursive: true });
await build({ entryPoints: ['src/admin.js'], bundle: true, outfile: `${destination}/admin.js`, format: 'iife', target: 'es2022', minify: false, legalComments: 'inline' });
await build({ entryPoints: ['src/browser-worker.js'], bundle: true, outfile: `${destination}/worker.js`, format: 'iife', target: 'es2022', minify: false, legalComments: 'inline' });
if (!process.argv.includes('--base-only')) await build({ entryPoints: ['pro/admin.js'], bundle: true, outfile: 'wordpress/fullbleed-commerce-pro/assets/admin.js', format: 'iife', target: 'es2022', minify: false, legalComments: 'inline' });
await cp('node_modules/fullbleed/dist/engine.wasm', `${destination}/engine.wasm`);
await cp('node_modules/fullbleed/assets/fonts', `${destination}/fonts`, { recursive: true });
await cp('node_modules/fullbleed/dist/THIRD_PARTY_NOTICES.txt', `${destination}/THIRD_PARTY_NOTICES.txt`);
await cp('node_modules/fullbleed/dist/build.json', `${destination}/engine-build.json`);
await cp('LICENSES/MIT-WASI.txt', `${destination}/WASI-LICENSE.txt`);
await cp('LICENSES/MIT-Fullbleed.txt', `${destination}/FULLBLEED-LICENSE.txt`);
if (!process.argv.includes('--base-only')) await cp('LICENSES/MIT-fflate.txt', 'wordpress/fullbleed-commerce-pro/assets/FFLATE-LICENSE.txt');
const report = {};
for (const file of ['admin.js', 'worker.js', 'engine.wasm']) {
  const bytes = await readFile(`${destination}/${file}`);
  report[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(`${destination}/build.json`, JSON.stringify({ engine: '2.5.5', nodePackage: '0.1.1', files: report }, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
