// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildDocument, starterTemplate } from '../src/documents.js';
import { renderOrder } from '../src/node.js';
import { TEMPLATE_SCHEMA, validateTemplate } from '../src/templates.js';
import { readTemplateRequest } from '../shopify/templates.js';
const fixture = JSON.parse(await readFile(new URL('../fixtures/order.json', import.meta.url)));
const template = (html, css = '') => ({ schema: TEMPLATE_SCHEMA, html, css });

test('editable starters expand every item and total without interpreting customer fields', () => {
  const order = structuredClone(fixture);
  order.items[0].name = '<img src=x onerror=alert(1)> {{seller.name}}';
  const input = starterTemplate();
  const document = buildDocument(order, { template: input });
  assert.ok(document.html.includes('&lt;img src=x onerror=alert(1)&gt; {{seller.name}}'));
  assert.ok(!document.html.includes('<img'));
  assert.ok(!document.html.includes('data-fb-repeat'));
  for (const item of order.items) assert.ok(document.html.includes(item.sku));
  for (const total of order.totals) assert.ok(document.html.includes(total.amount));
  assert.ok(document.html.includes('grand-total'));
  assert.ok(!JSON.stringify(input).includes(fixture.customer.name));
});

test('static HTML import preserves print CSS and rejects executable or remote content', () => {
  const css = '@page { size: Letter; margin: 17mm; }\n/* Keep my print rules. */\nh1 { color: #235132; }';
  const good = validateTemplate(template('<html lang="en"><head><meta charset="utf-8"><title>Test</title><style>p{margin:2pt}</style></head><body><h1>{{order.number}}</h1></body></html>', css));
  assert.ok(good.css.endsWith(css));
  assert.equal(good.html, '<h1>{{order.number}}</h1>');
  for (const html of ['<script>alert(1)</script>', '<img src="https://example.com/a.png">', '<p onclick="alert(1)">x</p>', '<iframe srcdoc="x"></iframe>', '<svg onload="alert(1)"></svg>', '<math><mtext><style>x</style></mtext></math>', '<a href="javascript:alert(1)">x</a>', '<p style="background:u&#114;l(https://example.com)">x</p>', '<div data-gjs-script="alert(1)">x</div>', '<img src="file:///etc/passwd">']) assert.throws(() => validateTemplate(template(html)), TypeError, html);
  for (const css of ['@import "https://example.com";', '@font-face{src:url(x)}', 'p{background:url(https://example.com)}', 'p{background:u\\72l(x)}', 'p{width:expression(alert(1))}', 'p{behavior:url(x)}', '@namespace x "https://example.com";', 'p{background:image-set("https://example.com/x" 1x)}']) assert.throws(() => validateTemplate(template('<p>Safe</p>', css)), TypeError, css);
});

test('repeat scopes, unknown fields, nesting and template size fail clearly', () => {
  for (const html of ['<p>{{order.secret}}</p>', '<p>{{item.name}}</p>', '<p class="{{order.number}}">x</p>', '<div data-fb-repeat="items"><div data-fb-repeat="items">{{item.name}}</div></div>', '<p>{{order.number</p>']) assert.throws(() => validateTemplate(template(html)), TypeError);
  assert.throws(() => validateTemplate(template('x'.repeat(350001))), /350 KB/);
  assert.throws(() => validateTemplate(template('<div>'.repeat(45) + 'x' + '</div>'.repeat(45))), /nesting/);
  assert.throws(() => validateTemplate(template('<p>{{customer.name}}</p>'), 'packing-slip'), /billing/);
  assert.throws(() => validateTemplate(template('<p data-fb-repeat="items">{{item.total}}</p>'), 'packing-slip'), /price/);
  const packing = buildDocument(fixture, { kind: 'packing-slip', template: starterTemplate({ kind: 'packing-slip' }) });
  assert.ok(!packing.html.includes('$'));
});

test('template requests have bounded streaming, media type and schema validation', async () => {
  const request = body => new Request('https://example.invalid/app/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = { intent: 'save', kind: 'order-summary', revision: '', template: starterTemplate() };
  assert.equal((await readTemplateRequest(request(body))).template.schema, TEMPLATE_SCHEMA);
  await assert.rejects(readTemplateRequest(request({ ...body, template: template('<script>x</script>') })), error => error.status === 422);
  await assert.rejects(readTemplateRequest(request({ ...body, kind: 'invoice' })), error => error.status === 400);
  await assert.rejects(readTemplateRequest(new Request('https://example.invalid', { method: 'POST', body: '{}' })), error => error.status === 415);
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(400000)); }, cancel() { cancelled = true; } });
  await assert.rejects(readTemplateRequest(new Request('https://example.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body: stream, duplex: 'half' })), error => error.status === 413);
  assert.equal(cancelled, true);
});

test('custom HTML and CSS produce deterministic Fullbleed PDFs with retained previews', async () => {
  const directory = new URL('../output/templates/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const records = [];
  for (const kind of ['order-summary', 'packing-slip']) {
    const input = starterTemplate({ kind, paper: 'A4' });
    input.html = '<div class="edition">FIELD NOTES / COMMERCE</div>' + input.html;
    input.css += '\n.edition { font-family: Bebas Neue; font-size: 13pt; letter-spacing: 3pt; color: #c5542d; margin-bottom: 10pt; } .hero { border-left: 0; padding-left: 0; border-top: 5pt solid #c5542d; padding-top: 12pt; margin: 16pt 0 18pt; } h1 { font-size: 38pt; } .footer { margin-top: 18pt; }';
    const first = await renderOrder(fixture, { kind, template: input, previewDpi: 96 });
    const second = await renderOrder(fixture, { kind, template: input });
    assert.deepEqual(first.pdf, second.pdf);
    assert.equal(first.missingGlyphs, 0);
    await writeFile(new URL(`${kind}.pdf`, directory), first.pdf);
    await writeFile(new URL(`${kind}.png`, directory), first.previews[0]);
    assert.equal(first.pages, 1);
    records.push({ kind, pages: first.pages, missingGlyphs: first.missingGlyphs, engineVersion: first.engineVersion, deterministic: true, sha256: createHash('sha256').update(first.pdf).digest('hex') });
  }
  await writeFile(new URL('verification.json', directory), JSON.stringify({ checkedAt: new Date().toISOString(), documents: records }, null, 2));
});


test('an embedded PNG logo reaches the PDF as an image object', async () => {
  const input = starterTemplate();
  input.html = '<img alt="Store logo" width="40" height="40" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGM8GqLLgA0wYRUdtBIAA9MBVn2Rt+4AAAAASUVORK5CYII=">' + input.html;
  const result = await renderOrder(fixture, { template: input });
  assert.match(result.pdf.toString('latin1'), /\/Subtype\s*\/Image/);
  assert.equal(result.missingGlyphs, 0);
});
