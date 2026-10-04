// SPDX-License-Identifier: MIT
// Retain real PDFs so an independent reader can check page membership and data.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { version, engineVersion } from 'fullbleed';
import { renderOrder } from '../src/node.js';
import { starterTemplate } from '../src/documents.js';
import { designs } from '../pro/designs.js';

const out = process.argv[2] || 'output/pagination';
await mkdir(out, { recursive: true });
// Keep a bounded, synchronous journal: a native crash cannot flush JS buffers.
// This runner only accepts checked-in synthetic fixtures, never merchant orders.
const progress = `${out}/progress.jsonl`;
writeFileSync(progress, '');
const started = performance.now();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const record = (phase, file, details = {}) => appendFileSync(progress, JSON.stringify({
  phase, file, elapsedMs: Math.round(performance.now() - started), rss: process.memoryUsage.rss(), ...details,
}) + '\n');
await writeFile(`${out}/runtime.json`, JSON.stringify({
  schema: 'fullbleed.commerce-pagination-runtime.v1', checkedAt: new Date().toISOString(),
  platform: process.platform, arch: process.arch, versions: process.versions,
  packageVersion: version, engineVersion,
  packageLockSha256: digest(await readFile('package-lock.json')),
  engineManifest: JSON.parse(await readFile(new URL('../dist/build.json', import.meta.resolve('fullbleed')), 'utf8')),
}, null, 2) + '\n');
const fixture = JSON.parse(await readFile('fixtures/order.json', 'utf8'));
const counts = [1, 7, 8, 9, 15, 16, 17, 23, 24, 25, 31, 32, 33, 48, 60];
const documents = [];
function orderFor(count) {
  const order = structuredClone(fixture);
  order.number = 'PAGINATION-13';
  order.items = Array.from({ length: count }, (_, i) => ({
    ...fixture.items[i % fixture.items.length], sku: `CHECK-${String(i + 1).padStart(3, '0')}`,
  }));
  // Merchant-supplied display amounts are intentionally not recalculated.
  order.totals = [{ label: 'Subtotal', amount: '$4,320.00' }, { label: 'Shipping', amount: '$12.00 via Standard delivery' }, { label: 'Total', amount: '$4,332.00', emphasis: true }];
  return order;
}
for (const [name, design] of Object.entries({ studio: undefined, ...designs })) {
  for (const paper of ['A4', 'Letter']) {
    for (const mode of ['built-in', 'starter']) {
      for (const count of counts) {
        const order = orderFor(count);
        const options = { kind: 'order-summary', paper, design };
        if (mode === 'starter') options.template = starterTemplate(options);
        const previewDpi = count === 32 ? 72 : 0;
        const stem = `${name}-${paper}-${mode}-${count}`;
        record('start', `${stem}.pdf`, { design: name, paper, mode, items: count, previewDpi });
        const result = await renderOrder(order, { ...options, previewDpi });
        assert.equal(result.missingGlyphs, 0);
        await writeFile(`${out}/${stem}.pdf`, result.pdf);
        if (result.previews.length) await writeFile(`${out}/${stem}-last.png`, result.previews.at(-1));
        documents.push({ file: `${stem}.pdf`, design: name, paper, mode, items: count, pages: result.pages, missingGlyphs: result.missingGlyphs, engineVersion: result.engineVersion, sha256: createHash('sha256').update(result.pdf).digest('hex') });
        record('retained', `${stem}.pdf`, { pages: result.pages, sha256: documents.at(-1).sha256 });
      }
      console.log(`${name} ${paper} ${mode}: ${counts.length} PDFs retained`);
    }
  }
}
// An existing merchant template remains authoritative, even when its old
// pagination differs from the new defaults. This hash predates the fix.
const saved = JSON.parse(await readFile('fixtures/pagination-saved-template.json', 'utf8'));
record('start', 'saved-011.pdf', { items: 32, mode: 'saved', previewDpi: 0 });
const unchanged = await renderOrder(orderFor(32), { template: saved.template });
const savedTemplate = { file: 'saved-011.pdf', sha256: createHash('sha256').update(unchanged.pdf).digest('hex'), expectedSha256: saved.expectedPdfSha256 };
await writeFile(`${out}/${savedTemplate.file}`, unchanged.pdf);
assert.equal(savedTemplate.sha256, savedTemplate.expectedSha256, 'Existing saved template PDF changed.');
record('retained', savedTemplate.file, { pages: unchanged.pages, sha256: savedTemplate.sha256 });
await writeFile(`${out}/rendered.json`, JSON.stringify({ schema: 'fullbleed.commerce-pagination.v1', checkedAt: new Date().toISOString(), documents, savedTemplate }, null, 2) + '\n');
record('complete', null, { documents: documents.length + 1 });
