// SPDX-License-Identifier: MIT
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir('dist', { recursive: true });
const records = [];
for (const name of ['fullbleed-commerce', 'fullbleed-commerce-pro']) {
  const files = {};
  async function addTree(directory, zipRoot) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const key = `${zipRoot}/${entry.name}`;
      if (entry.isDirectory()) await addTree(path, key);
      else files[key] = new Uint8Array(await readFile(path));
    }
  }
  await addTree(`wordpress/${name}`, name);
  if (name === 'fullbleed-commerce') {
    for (const file of ['src/admin.js', 'src/browser-worker.js', 'src/documents.js', 'src/templates.js', 'src/editor-entry.js', 'src/template-editor.js', 'src/template-editor.css', 'tools/build.mjs', 'tools/wordpress-editor.mjs', 'package.json', 'package-lock.json', 'LICENSES/MIT-WASI.txt', 'LICENSES/MIT-Fullbleed.txt', 'LICENSES/MIT-CodeMirror-formatting.txt', 'LICENSES/MIT-Spectrum.txt', 'LICENSES/MIT-Cash.txt']) {
      let content = await readFile(file);
      if (file === 'package.json') {
        const pkg = JSON.parse(content);
        pkg.scripts = { build: 'node tools/build.mjs --base-only' };
        content = Buffer.from(JSON.stringify(pkg, null, 2));
      }
      files[`${name}/source/${file}`] = new Uint8Array(content);
    }
    files[`${name}/source/README.txt`] = new TextEncoder().encode('Build with Node.js 24.18+: npm ci --ignore-scripts && npm run build. Output is under wordpress/fullbleed-commerce/assets/generated. Copy that directory to the installed plugin assets/generated directory. Source entrypoints and dependency versions are included; no Pro-only code is included in this package.');
  } else {
    for (const file of ['pro/admin.js', 'pro/designs.js']) files[`${name}/source/${file.split('/').at(-1)}`] = new Uint8Array(await readFile(file));
    files[`${name}/source/README.txt`] = new TextEncoder().encode('Build admin.js with esbuild 0.28.2, bundled in IIFE format targeting es2022, with fflate 0.8.3. The base plugin exposes window.FullbleedCommerce. The compiled assets/admin.js is readable and includes the complete add-on code.');
  }
  // ZIP stores local DOS date/time fields without a timezone. Construct those
  // fields directly so identical sources produce identical archives in any TZ.
  const archive = zipSync(files, { level: 9, mtime: new Date(2020, 0, 1, 0, 0, 0) });
  const filename = `${name}-${version}.zip`;
  await writeFile(`dist/${filename}`, archive);
  records.push({ filename, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), files: Object.keys(files).length });
}
await writeFile('dist/SHA256SUMS.txt', records.map(r => `${r.sha256}  ${r.filename}`).join('\n') + '\n');
await writeFile('dist/packages.json', JSON.stringify(records, null, 2) + '\n');
console.log(JSON.stringify(records, null, 2));
