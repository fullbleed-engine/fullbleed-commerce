// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDocument, validateOrder } from '../src/documents.js';
import { renderOrder } from '../src/node.js';
const fixture = JSON.parse(await readFile(new URL('../fixtures/order.json', import.meta.url)));

test('merchant totals are copied without recalculating tax or discounts', () => {
  const { html } = buildDocument(fixture);
  for (const value of ['$270.00', '-$20.00', '$12.00', '$20.96', '$282.96']) assert.ok(html.includes(value));
});
test('packing slip has quantities and shipping details but no prices or billing name', () => {
  const order = structuredClone(fixture);
  order.customer.name = 'PRIVATE BILLING NAME';
  const { html } = buildDocument(order, { kind: 'packing-slip' });
  assert.ok(html.includes('42 Example Street'));
  assert.ok(html.includes('LIN-MOSS'));
  assert.ok(!html.includes('$'));
  assert.ok(!html.includes('PRIVATE BILLING NAME'));
});
test('order content cannot inject markup or external resources', () => {
  const order = structuredClone(fixture);
  order.items[0].name = '<img src="https://invalid.example/customer"><script>alert(1)</script>';
  order.number = '../../<svg onload="x">';
  const document = buildDocument(order, { footer: '<style>body { display:none }</style>' });
  assert.ok(!document.html.includes('<img'));
  assert.ok(!document.html.includes('<script>'));
  assert.ok(!document.html.includes('<style>'));
  assert.match(document.filename, /^[\w-]+\.pdf$/);
  assert.throws(() => buildDocument(fixture, { accent: 'red; background:url(https://invalid.example)' }));
  assert.throws(() => buildDocument(fixture, { design: { ink: 'url(x)' } }));
});
test('oversized and invalid quantities reject before rendering', () => {
  const order = structuredClone(fixture);
  order.items[0].quantity = 'Infinity';
  assert.throws(() => validateOrder(order));
  order.items = Array.from({ length: 251 }, () => fixture.items[0]);
  assert.throws(() => validateOrder(order));
});
test('published Node package renders real deterministic PDFs and recovers after rejection', async () => {
  const first = await renderOrder(fixture, { previewDpi: 72 });
  const second = await renderOrder(fixture);
  assert.equal(first.pages, 1);
  assert.equal(first.missingGlyphs, 0);
  assert.equal(first.engineVersion, '2.5.6');
  assert.equal(first.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(first.pdf, second.pdf);
  assert.equal(first.previews[0].subarray(1, 4).toString(), 'PNG');
  const invalid = structuredClone(fixture);
  invalid.items[0].name = '\u{1f47d}';
  await assert.rejects(renderOrder(invalid), { code: 'MISSING_GLYPHS' });
  const recovered = await renderOrder(fixture, { kind: 'packing-slip', paper: 'Letter' });
  assert.equal(recovered.pages, 1);
});
