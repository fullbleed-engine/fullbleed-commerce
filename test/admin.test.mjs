// SPDX-License-Identifier: MIT
// DOM unit tests, not a browser or marketplace acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { renderPdf } from 'fullbleed';
const fixture = JSON.parse(await readFile(new URL('../fixtures/order.json', import.meta.url)));
const base = await readFile(new URL('../wordpress/fullbleed-commerce/assets/generated/admin.js', import.meta.url), 'utf8');
const pro = await readFile(new URL('../wordpress/fullbleed-commerce-pro/assets/admin.js', import.meta.url), 'utf8');

function setup(isPro = false, denied = [], { delayExtension = false } = {}) {
  const config = { endpoint: 'https://store.example/orders', assets: 'https://store.example/assets/', nonce: 'test-only', extensions: isPro ? ['fullbleed-commerce-pro'] : [], themes: [{ value: 'studio', label: 'Studio' }, ...(isPro ? [{ value: 'contrast', label: 'Contrast' }, { value: 'quiet', label: 'Quiet' }] : [])] };
  const dom = new JSDOM(`<div id="fullbleed-commerce"><form><input name="order_ids" value="1042"><select name="kind"><option value="order-summary">Order</option><option value="packing-slip">Packing</option></select><select name="theme">${config.themes.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select><select name="paper"><option>A4</option><option>Letter</option></select><input name="accent" value="#c5542d"><textarea name="footer">Thank you.</textarea><button data-render type="submit" disabled>Generate</button></form><p data-status></p><a data-preview hidden></a></div>`, { url: 'https://store.example/admin', runScripts: 'outside-only' });
  const { window } = dom;
  window.document.querySelector('#fullbleed-commerce').dataset.config = JSON.stringify(config);
  const urls = new Map(); const downloads = []; const requests = []; const terminated = [];
  window.Blob = Blob;
  window.URL.createObjectURL = blob => { const url = 'blob:test-' + urls.size; urls.set(url, blob); return url; };
  window.URL.revokeObjectURL = url => urls.delete(url);
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: urls.get(this.href) }); };
  window.fetch = async (url, options) => {
    assert.ok(url.startsWith(config.endpoint + '/'));
    assert.equal(options.headers['X-WP-Nonce'], config.nonce);
    assert.equal(options.cache, 'no-store');
    requests.push(url);
    if (denied.includes(url.split('/').at(-1))) return new Response(JSON.stringify({ message: 'This order is not permitted.' }), { status: 403 });
    return new Response(JSON.stringify(fixture));
  };
  window.Worker = class {
    constructor(url) { assert.equal(url, config.assets + 'worker.js'); }
    postMessage(document) {
      renderPdf({ ...document, maxPages: 30 }).then(result => this.onmessage?.({ data: { ok: true, pdf: result.pdf, pages: result.pages } }), error => this.onmessage?.({ data: { ok: false, error: error.message } }));
    }
    terminate() { terminated.push(true); }
  };
  window.eval(base);
  if (isPro && !delayExtension) window.eval(pro);
  const api = window.FullbleedCommerce;
  const submit = async () => {
    api.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const deadline = Date.now() + 10000;
    while (api.root.querySelector('[data-render]').disabled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(api.root.querySelector('[data-render]').disabled, false, 'Form must recover after success or failure.');
  };
  return { window, api, urls, requests, downloads, terminated, submit, loadExtension: () => window.eval(pro), close: () => dom.window.close() };
}

test('declared add-ons keep generation disabled until their designs and handlers are ready', async () => {
  const app = setup(true, [], { delayExtension: true });
  try {
    const button = app.api.root.querySelector('[data-render]');
    assert.equal(button.disabled, true);
    app.api.registerExtension('an-unrelated-extension');
    app.api.form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(button.disabled, true);
    assert.equal(app.requests.length, 0);
    app.loadExtension();
    assert.equal(button.disabled, false);
    app.api.form.elements.order_ids.value = '1042,1043';
    app.api.form.elements.theme.value = 'contrast';
    await app.submit();
    const files = unzipSync(new Uint8Array(await app.downloads[0].blob.arrayBuffer()));
    assert.equal(Object.keys(files).length, 2);
    assert.ok(Object.values(files).every(bytes => Buffer.from(bytes).subarray(0, 5).toString() === '%PDF-'));
  } finally { app.close(); }
});

test('free admin creates a real PDF and invalidates an old download when inputs change', async () => {
  const app = setup();
  try {
    await app.submit();
    const link = app.api.root.querySelector('[data-preview]');
    assert.equal(link.hidden, false);
    assert.equal(link.download, 'order-summary-CF-1042.pdf');
    const bytes = Buffer.from(await app.urls.get(link.href).arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(app.terminated.length, 1);
    app.api.form.elements.paper.value = 'Letter';
    app.api.form.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(link.hidden, true);
    assert.equal(app.urls.size, 0);
    app.api.form.elements.order_ids.value = '1042,1043';
    await app.submit();
    assert.match(app.api.root.querySelector('[data-status]').textContent, /valid numeric order ID/);
    assert.equal(app.requests.length, 1);
  } finally { app.close(); }
});

test('Pro exports a ZIP containing complete PDFs and its own design code', async () => {
  const app = setup(true);
  try {
    app.api.form.elements.order_ids.value = '1042,1043,1042';
    app.api.form.elements.theme.value = 'contrast';
    await app.submit();
    assert.equal(app.downloads.length, 1);
    const files = unzipSync(new Uint8Array(await app.downloads[0].blob.arrayBuffer()));
    assert.deepEqual(Object.keys(files), ['1042-order-summary-CF-1042.pdf', '1043-order-summary-CF-1042.pdf']);
    for (const bytes of Object.values(files)) assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
    assert.ok(!base.includes('zipSync'));
    // CSS parsers legitimately contain names such as the contrast() function.
    // Check the actual add-on source boundary, not English words in dependencies.
    assert.ok(!base.includes('// pro/designs.js'));
    assert.ok(!base.includes('// pro/admin.js'));
  } finally { app.close(); }
});

test('a forbidden order stops the entire batch without a partial ZIP, and retry works', async () => {
  const app = setup(true, ['999']);
  try {
    app.api.form.elements.order_ids.value = '1042,999';
    await app.submit();
    assert.equal(app.downloads.length, 0);
    assert.match(app.api.root.querySelector('[data-status]').textContent, /not permitted/);
    app.api.form.elements.order_ids.value = '1042,1043';
    await app.submit();
    assert.equal(app.downloads.length, 1);
  } finally { app.close(); }
});

test('worker timeout restores controls and does not offer a stale PDF', async () => {
  const app = setup();
  try {
    let stopped = false;
    app.window.Worker = class { postMessage() {} terminate() { stopped = true; } };
    const original = app.window.setTimeout.bind(app.window);
    app.window.setTimeout = (fn, ms) => original(fn, ms === 30000 ? 5 : ms);
    await app.submit();
    assert.equal(stopped, true);
    assert.match(app.api.root.querySelector('[data-status]').textContent, /too long/);
    assert.equal(app.api.root.querySelector('[data-preview]').hidden, true);
  } finally { app.close(); }
});
