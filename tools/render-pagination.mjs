// SPDX-License-Identifier: MIT
// Retain real PDFs so an independent reader can check page membership and data.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderOrder } from '../src/node.js';
import { starterTemplate } from '../src/documents.js';
import { designs } from '../pro/designs.js';

const out = process.argv[2] || 'output/pagination';
await mkdir(out, { recursive: true });
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
        const result = await renderOrder(order, { ...options, previewDpi: count === 32 ? 72 : 0 });
        assert.equal(result.missingGlyphs, 0);
        const stem = `${name}-${paper}-${mode}-${count}`;
        await writeFile(`${out}/${stem}.pdf`, result.pdf);
        if (result.previews.length) await writeFile(`${out}/${stem}-last.png`, result.previews.at(-1));
        documents.push({ file: `${stem}.pdf`, design: name, paper, mode, items: count, pages: result.pages, missingGlyphs: result.missingGlyphs, engineVersion: result.engineVersion, sha256: createHash('sha256').update(result.pdf).digest('hex') });
      }
      console.log(`${name} ${paper} ${mode}: ${counts.length} PDFs retained`);
    }
  }
}
// An existing merchant template remains authoritative, even when its old
// pagination differs from the new defaults. This hash predates the fix.
const saved = JSON.parse(await readFile('fixtures/pagination-saved-template.json', 'utf8'));
const unchanged = await renderOrder(orderFor(32), { template: saved.template });
const savedTemplate = { file: 'saved-011.pdf', sha256: createHash('sha256').update(unchanged.pdf).digest('hex'), expectedSha256: saved.expectedPdfSha256 };
await writeFile(`${out}/${savedTemplate.file}`, unchanged.pdf);
assert.equal(savedTemplate.sha256, savedTemplate.expectedSha256, 'Existing saved template PDF changed.');
await writeFile(`${out}/rendered.json`, JSON.stringify({ schema: 'fullbleed.commerce-pagination.v1', checkedAt: new Date().toISOString(), documents, savedTemplate }, null, 2) + '\n');
