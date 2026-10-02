// SPDX-License-Identifier: MIT
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderOrder } from '../src/node.js';
import { designs } from '../pro/designs.js';
const order = JSON.parse(await readFile('fixtures/order.json', 'utf8'));
await mkdir('output/examples', { recursive: true });
const records = [];
for (const [name, design] of Object.entries({ studio: undefined, ...designs })) {
  for (const kind of ['order-summary', 'packing-slip']) {
    const result = await renderOrder(order, { kind, design, previewDpi: 96, footer: 'Objects for everyday rituals. Made to be kept.' });
    const stem = `${name}-${kind}`;
    await writeFile(`output/examples/${stem}.pdf`, result.pdf);
    for (const [i, png] of result.previews.entries()) await writeFile(`output/examples/${stem}-${i + 1}.png`, png);
    records.push({ stem, pages: result.pages, missingGlyphs: result.missingGlyphs, engineVersion: result.engineVersion, sha256: createHash('sha256').update(result.pdf).digest('hex') });
  }
}
await writeFile('output/examples/verification.json', JSON.stringify(records, null, 2) + '\n');
console.log(JSON.stringify(records, null, 2));
