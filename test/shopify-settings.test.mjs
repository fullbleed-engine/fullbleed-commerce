import test from 'node:test';
import assert from 'node:assert/strict';
import { readSettingsForm } from '../shopify/settings-form.js';

test('brand forms preserve encoded text and newlines', async () => {
  const form = await readSettingsForm(new Request('https://test.invalid', { method: 'POST', body: new URLSearchParams({ sellerName: 'A & B', sellerLines: 'One\nTwo', footer: 'Café' }) }));
  assert.equal(form.get('sellerName'), 'A & B');
  assert.equal(form.get('sellerLines'), 'One\nTwo');
  assert.equal(form.get('footer'), 'Café');
});

test('chunked settings stop at the byte limit and cancel the stream', async () => {
  let canceled = false;
  let chunks = 0;
  const body = new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(4096).fill(65)); }, cancel() { canceled = true; } });
  const request = new Request('https://test.invalid', { method: 'POST', duplex: 'half', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  await assert.rejects(readSettingsForm(request), error => error instanceof Response && error.status === 413);
  assert.equal(canceled, true);
  assert.ok(chunks <= 4);
});

test('settings reject wrong content types and declared oversized bodies', async () => {
  await assert.rejects(readSettingsForm(new Request('https://test.invalid', { method: 'POST', body: '{}' })), error => error.status === 415);
  await assert.rejects(readSettingsForm(new Request('https://test.invalid', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '8193' }, body: 'a=b' })), error => error.status === 413);
});
