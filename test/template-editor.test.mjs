// SPDX-License-Identifier: MIT
// DOM interaction coverage for the shared standalone editor. WordPress core
// dependency integration is exercised against WordPress by check-browser.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { starterTemplate } from '../src/documents.js';
const bundled = await build({ entryPoints: ['src/editor-entry.js'], bundle: true, write: false, format: 'iife', target: 'es2022' });
const source = bundled.outputFiles[0].text;

test('visual editor, source editing and PDF preview share the saved template without losing print CSS', async () => {
  const dom = new JSDOM('<!doctype html><div id="editor"></div>', { url: 'https://merchant.invalid/admin', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.TextEncoder = TextEncoder;
  window.Blob = Blob;
  window.URL.createObjectURL = () => 'blob:synthetic-preview';
  window.URL.revokeObjectURL = () => {};
  window.eval(source);
  const host = window.document.querySelector('#editor');
  const saved = [];
  const previews = [];
  const defaults = starterTemplate();
  defaults.css += '\n@page :first { margin-top: 18mm; } /* preserve this exactly */';
  const instance = window.FullbleedTemplateEditor.mount(host, { kind: 'order-summary', defaults, onSave: async value => saved.push(value), onReset: async () => {}, onPreview: async value => { previews.push(value); return new Blob(['%PDF-test'], { type: 'application/pdf' }); } });
  // Flush handlers without asking jsdom to lay out an interactive iframe.
  // Canvas layout and real download behavior remain a separate browser gate.
  async function click(selector) { host.querySelector(selector).click(); for (let i = 0; i < 8; i++) await Promise.resolve(); }
  try {
    assert.equal(host.querySelector('[data-visual]').hidden, false);
    assert.equal(window.document.querySelector('link[href*="cdnjs.cloudflare.com"]'), null, 'A missing font base must not fall back to remote icons.');
    const initial = instance.getTemplate();
    assert.ok(initial.css.includes(defaults.css));
    assert.ok(initial.html.includes('data-fb-repeat="items"'));
    await click('[data-mode="source"]');
    const html = host.querySelector('[data-html]');
    html.value = '<h2>Merchant custom edition</h2>' + html.value;
    html.dispatchEvent(new window.Event('input', { bubbles: true }));
    await click('[data-action="save"]');
    assert.equal(saved.length, 1);
    assert.ok(saved[0].html.includes('Merchant custom edition'));
    await click('[data-mode="visual"]');
    assert.ok(instance.getTemplate().css.includes(defaults.css));
    await click('[data-action="preview"]');
    assert.equal(previews.length, 1);
    assert.ok(previews[0].html.includes('Merchant custom edition'));
    assert.equal(host.querySelector('[data-pdf]').hidden, false);
    await click('[data-mode="source"]');
    html.value = '<img src="https://external.invalid/leak">';
    html.dispatchEvent(new window.Event('input', { bubbles: true }));
    await click('[data-mode="visual"]');
    assert.match(host.querySelector('[data-message]').textContent, /embedded PNG or JPEG/);
    assert.equal(host.querySelector('[data-source]').hidden, false);
    assert.equal(host.querySelector('[data-pdf]').hidden, true);
    assert.equal(saved.length, 1);
  } finally { instance.destroy(); window.close(); }
});
