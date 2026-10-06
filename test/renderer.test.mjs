import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRenderer } from '../automation/renderer.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const token = 'synthetic-renderer-token-not-for-production';
const clients = [{ site: 'synthetic-store', tokenSha256: createHash('sha256').update(token).digest('hex') }];
const fixture = JSON.parse(readFileSync('fixtures/order.json', 'utf8'));
function request(input, headers = {}) {
  return new Request('https://renderer.invalid/v1/render', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Fullbleed-Site': 'synthetic-store', ...headers }, body: JSON.stringify(input) });
}
const input = { order: fixture, options: { kind: 'order-summary' } };

test('server automation renders a complete deterministic PDF without retaining the order', async () => {
  const render = createRenderer({ clients });
  const a = await render(request(input));
  assert.equal(a.status, 200); assert.equal(a.headers.get('Content-Type'), 'application/pdf');
  assert.match(a.headers.get('Cache-Control'), /no-store/);
  const bytes = Buffer.from(await a.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const b = await render(request(input)); assert.deepEqual(Buffer.from(await b.arrayBuffer()), bytes);
  assert.equal(a.headers.get('X-Fullbleed-Sha256'), createHash('sha256').update(bytes).digest('hex'));
  mkdirSync('output/automation', { recursive: true }); writeFileSync('output/automation/renderer.pdf', bytes);
});

test('renderer rejects forged clients, unsafe templates, oversized requests and unsupported options', async () => {
  const render = createRenderer({ clients });
  assert.equal((await render(request(input, { Authorization: 'Bearer wrong' }))).status, 401);
  assert.equal((await render(request(input, { 'X-Fullbleed-Site': 'someone-else' }))).status, 401);
  assert.equal((await render(request(input, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await render(request({ ...input, options: { kind: 'invoice' } }))).status, 422);
  assert.equal((await render(request({ ...input, options: { kind: 'order-summary', template: { schema: 'fullbleed.commerce-template.v1', html: '<script>alert(1)</script>', css: '' } } }))).status, 422);
  assert.equal((await render(request({ data: 'x'.repeat(786433) }))).status, 413);
});

test('renderer bounds concurrency and attempts and releases failed work', async () => {
  let release; let time = 1000;
  const render = createRenderer({ clients, hourlyLimit: 2, now: () => time, render: () => new Promise(resolve => { release = resolve; }) });
  const pending = render(request(input));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await render(request(input))).status, 429);
  release({ pdf: Buffer.from('%PDF-synthetic'), filename: 'test.pdf' }); assert.equal((await pending).status, 200);
  assert.equal((await render(request({ ...input, options: {} }))).status, 422);
  const capped = await render(request(input)); assert.equal(capped.status, 429); assert.equal(capped.headers.get('Retry-After'), '3600');
  time += 3600001;
  assert.equal((await render(request({ ...input, options: {} }))).status, 422);
});

test('standalone HTTP service survives a killed renderer and returns the next verified PDF', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fullbleed-renderer-test-'));
  const config = join(directory, 'clients.json'); await writeFile(config, JSON.stringify(clients), { mode: 0o600 });
  const child = spawn(process.execPath, ['--import', new URL('fixtures/kill-first-render.mjs', import.meta.url).href, 'automation/server.mjs'], { env: { ...process.env, FULLBLEED_RENDER_CLIENTS_FILE: config, PORT: '0', BIND_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  try {
    const ready = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Renderer exited before ready: ' + errors); })]);
    const { port } = JSON.parse(ready[0].toString());
    const url = `http://127.0.0.1:${port}/v1/render`;
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    const failed = await fetch(url, { method: 'POST', headers: Object.fromEntries(request(input).headers), body: JSON.stringify(input) });
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), { code: 'render_failed', message: 'The document could not be rendered. Check the preview and retry.' });
    assert.match(failed.headers.get('Cache-Control'), /no-store/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    assert.equal(child.exitCode, null, 'The HTTP server must survive the render child failure.');
    const response = await fetch(url, { method: 'POST', headers: Object.fromEntries(request(input).headers), body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), response.headers.get('X-Fullbleed-Sha256'));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await unlink(config); await rmdir(directory);
  }
});
