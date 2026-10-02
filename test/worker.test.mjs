// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildDocument, starterTemplate } from '../src/documents.js';
import { renderOrder } from '../src/node.js';
const fixture = JSON.parse(await readFile(new URL('../fixtures/order.json', import.meta.url)));
const base = new URL('../wordpress/fullbleed-commerce/assets/generated/', import.meta.url);
const source = await readFile(new URL('worker.js', base), 'utf8');

async function runWorker(data) {
  let finish;
  const result = new Promise(resolve => { finish = resolve; });
  const self = { location: { href: 'https://store.example/assets/worker.js' }, postMessage: finish };
  const fetch = async url => {
    assert.equal(url.origin, 'https://store.example');
    const relative = url.pathname.replace(/^\/assets\//, '');
    assert.ok(!relative.includes('..'));
    return new Response(await readFile(new URL(relative, base)));
  };
  const context = vm.createContext({ self, fetch, URL, TextEncoder, TextDecoder, WebAssembly, Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, BigInt64Array, BigUint64Array, DataView, ArrayBuffer, SharedArrayBuffer, console, performance });
  vm.runInContext(source, context);
  await self.onmessage({ data });
  return result;
}

test('browser worker renders the same PDF as the published Node package', async () => {
  const document = buildDocument(fixture);
  const worker = await runWorker(document);
  assert.equal(worker.ok, true, worker.error);
  const node = await renderOrder(fixture);
  assert.deepEqual(Buffer.from(worker.pdf), node.pdf);
  assert.equal(worker.pages, 1);
});
test('worker rejects missing glyphs and oversized documents with no partial PDF', async () => {
  const invalid = structuredClone(fixture);
  invalid.items[0].name = '\u{1f47d}';
  const result = await runWorker(buildDocument(invalid));
  assert.equal(result.ok, false);
  assert.equal(result.pdf, undefined);
  assert.match(result.error, /MISSING_GLYPHS/);
  const large = await runWorker({ html: 'x'.repeat(500001), css: '' });
  assert.equal(large.ok, false);
  assert.match(large.error, /too large/);
});

test('custom templates render identical complete PDFs through the local browser worker', async () => {
  const template = starterTemplate();
  template.html = '<h2>THE PERSONAL EDITION</h2>' + template.html;
  template.css += '\nh2 { font-family: Bebas Neue; font-size: 14pt; color: #c5542d; }';
  const document = buildDocument(fixture, { template });
  const worker = await runWorker(document);
  const node = await renderOrder(fixture, { template });
  assert.equal(worker.ok, true, worker.error);
  assert.deepEqual(Buffer.from(worker.pdf), node.pdf);
});
