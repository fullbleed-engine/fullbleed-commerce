// SPDX-License-Identifier: MIT
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { renderOrder } from '../src/node.js';
const fixture = JSON.parse(await readFile('fixtures/order.json', 'utf8'));
const order = structuredClone(fixture);
order.number = 'LONG-1043';
order.items = Array.from({ length: 60 }, (_, i) => ({
  name: `Item ${String(i + 1).padStart(3, '0')} / A carefully woven linen textile with a detailed description of its finish, texture and care. This is a deliberately long product title to check wrapping across multiple lines.`,
  sku: `LONG-${String(i + 1).padStart(3, '0')}`, quantity: '1', total: '$10.00',
}));
order.totals = [{ label: 'Total', amount: '$600.00', emphasis: true }];
await mkdir('output/layout', { recursive: true });
for (const kind of ['order-summary', 'packing-slip']) {
  const result = await renderOrder(order, { kind, previewDpi: 72 });
  if (result.pages <= 1 || result.pages > 30 || result.missingGlyphs !== 0) throw new Error('Long-order layout failed.');
  await writeFile(`output/layout/${kind}.pdf`, result.pdf);
  for (const [i, png] of result.previews.entries()) await writeFile(`output/layout/${kind}-${i + 1}.png`, png);
  console.log(JSON.stringify({ kind, pages: result.pages, missingGlyphs: result.missingGlyphs }));
}
