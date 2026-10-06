// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRenderer } from '../automation/renderer.js';
import { renderOrder } from '../src/node.js';
import { createRenderLimit } from '../shopify/render-limit.js';

const order = JSON.parse(readFileSync('fixtures/order.json', 'utf8'));
const missingGlyphOrder = { ...order, customer: { ...order.customer, name: 'Missing: \u2a0c' } };
const token = 'synthetic-lifecycle-token-not-for-production';
const sites = ['synthetic-store-a', 'synthetic-store-b'];
const clients = sites.map(site => ({ site, tokenSha256: createHash('sha256').update(token).digest('hex') }));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function request(document = order, { site = sites[0], signal } = {}) {
  return new Request('https://renderer.invalid/v1/render', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Fullbleed-Site': site },
    body: JSON.stringify({ order: document, options: { kind: 'order-summary' } }),
  });
}

// Observe real render children. The observer neither replaces the renderer nor
// pretends a process has exited; failure tests deliberately kill an actual child.
function observeProcesses(t, onCreate = () => {}) {
  const original = ChildProcess.prototype.spawn;
  const active = new Set();
  const created = [];
  const parentWorkers = [];
  let peak = 0;
  ChildProcess.prototype.spawn = function(options) {
    if (!options.args.some(arg => String(arg).endsWith('process-worker.cjs'))) return original.call(this, options);
    created.push(this);
    active.add(this);
    peak = Math.max(peak, active.size);
    this.once('exit', () => active.delete(this));
    this.once('close', () => active.delete(this));
    const result = original.call(this, options);
    onCreate(this, created.length);
    return result;
  };
  const observe = worker => parentWorkers.push(worker);
  process.on('worker', observe);
  t.after(async () => {
    process.off('worker', observe);
    ChildProcess.prototype.spawn = original;
    await Promise.all([...active].map(child => new Promise(resolve => {
      child.once('close', resolve);
      child.kill('SIGKILL');
    })));
    await Promise.all(parentWorkers.filter(worker => worker.threadId !== -1).map(worker => worker.terminate()));
  });
  return {
    get peak() { return peak; },
    stopped(count) {
      assert.equal(created.length, count, 'The integration must create real PDF child processes.');
      assert.equal(active.size, 0, 'Returning renderer capacity must wait for every child to exit.');
      assert.ok(created.every(child => !child.connected), 'IPC must close before renderer capacity is returned.');
      assert.equal(parentWorkers.length, 0, 'The server must not create PDF workers in its own process.');
    },
  };
}

test('completed automation responses release children before another store can render', { timeout: 20000 }, async t => {
  const workers = observeProcesses(t);
  const render = createRenderer({ clients, globalLimit: 1 });
  const hashes = [];
  for (const [index, site] of sites.entries()) {
    const response = await render(request(order, { site }));
    assert.equal(response.status, 200);
    workers.stopped(index + 1);
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    hashes.push(hash(pdf));
  }
  assert.equal(workers.peak, 1);
  assert.equal(new Set(hashes).size, 1);
});

test('failed automation renders finish child cleanup before accepting recovery', { timeout: 20000 }, async t => {
  const workers = observeProcesses(t);
  const render = createRenderer({ clients, globalLimit: 1 });
  const failure = await render(request(missingGlyphOrder));
  assert.equal(failure.status, 502);
  assert.equal((await failure.json()).code, 'render_failed');
  workers.stopped(1);
  const recovered = await render(request());
  assert.equal(recovered.status, 200);
  workers.stopped(2);
  assert.equal(workers.peak, 1);
});

test('cancelled automation keeps its capacity until the child exits and then recovers', { timeout: 20000 }, async t => {
  const controller = new AbortController();
  const render = createRenderer({ clients, globalLimit: 1 });
  let blocked;
  const workers = observeProcesses(t, (child, count) => {
    if (count === 1) child.once('spawn', () => {
      blocked = render(request(order, { site: sites[1] }));
      controller.abort();
    });
  });
  const cancelled = await render(request(order, { signal: controller.signal }));
  assert.equal(cancelled.status, 504);
  workers.stopped(1);
  assert.equal((await blocked).status, 429);
  const recovered = await render(request(order, { site: sites[1] }));
  assert.equal(recovered.status, 200);
  workers.stopped(2);
  assert.equal(workers.peak, 1);
});

test('Shopify render capacity covers child cleanup on cancellation, rejection, and success', { timeout: 20000 }, async t => {
  const controller = new AbortController();
  const limit = createRenderLimit({ maxTotal: 1 });
  let blocked;
  const workers = observeProcesses(t, (child, count) => {
    if (count === 1) child.once('spawn', () => {
      blocked = Promise.all(sites.map(site => assert.rejects(
        limit(site, () => renderOrder(order)),
        error => error instanceof Response && error.status === 429,
      )));
      controller.abort();
    });
  });
  await assert.rejects(limit(sites[0], () => renderOrder(order, { signal: controller.signal })), error => error.code === 'ABORTED');
  workers.stopped(1);
  await blocked;
  await assert.rejects(limit(sites[1], () => renderOrder(missingGlyphOrder)), error => error.code === 'MISSING_GLYPHS');
  workers.stopped(2);
  const hashes = [];
  for (const [index, site] of sites.entries()) {
    const result = await limit(site, () => renderOrder(order));
    workers.stopped(index + 3);
    hashes.push(hash(result.pdf));
  }
  assert.equal(workers.peak, 1);
  assert.equal(new Set(hashes).size, 1);
});

test('a killed automation child returns a safe failure and releases capacity for the next store', { timeout: 20000 }, async t => {
  const render = createRenderer({ clients, globalLimit: 1 });
  let blocked;
  const children = observeProcesses(t, (child, count) => {
    if (count === 1) child.once('spawn', () => {
      blocked = render(request(order, { site: sites[1] }));
      child.kill('SIGKILL');
    });
  });
  const failed = await render(request());
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { code: 'render_failed', message: 'The document could not be rendered. Check the preview and retry.' });
  children.stopped(1);
  assert.equal((await blocked).status, 429);
  assert.equal((await render(new Request('https://renderer.invalid/health'))).status, 200);
  const recovered = await render(request(order, { site: sites[1] }));
  assert.equal(recovered.status, 200);
  assert.equal(Buffer.from(await recovered.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  children.stopped(2);
  assert.equal(children.peak, 1);
});

test('Shopify capacity is released after child termination and a subsequent PDF succeeds', { timeout: 20000 }, async t => {
  const limit = createRenderLimit({ maxTotal: 1 });
  const children = observeProcesses(t, (child, count) => {
    if (count === 1) child.once('spawn', () => child.kill('SIGKILL'));
  });
  await assert.rejects(limit(sites[0], () => renderOrder(order)), error => error.code === 'PROCESS_FAILED');
  children.stopped(1);
  assert.equal((await limit(sites[1], () => renderOrder(order))).pages, 1);
  children.stopped(2);
  assert.equal(children.peak, 1);
});
