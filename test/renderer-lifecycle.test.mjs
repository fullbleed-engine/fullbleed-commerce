// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

// Observe actual Node workers without replacing the renderer or its termination.
function observeWorkers(t, onCreate = () => {}) {
  const active = new Set();
  const created = [];
  let peak = 0;
  const observe = worker => {
    created.push(worker);
    active.add(worker);
    peak = Math.max(peak, active.size);
    worker.once('exit', () => active.delete(worker));
    onCreate(worker, created.length);
  };
  process.on('worker', observe);
  t.after(async () => {
    process.off('worker', observe);
    await Promise.all([...active].map(worker => worker.terminate()));
  });
  return {
    get peak() { return peak; },
    stopped(count) {
      assert.equal(created.length, count, 'The integration must create real PDF workers.');
      assert.equal(active.size, 0, 'Returning renderer capacity must wait for every worker to exit.');
      assert.ok(created.every(worker => worker.threadId === -1));
    },
  };
}

test('completed automation responses release workers before another store can render', { timeout: 20000 }, async t => {
  const workers = observeWorkers(t);
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

test('failed automation renders finish worker cleanup before accepting recovery', { timeout: 20000 }, async t => {
  const workers = observeWorkers(t);
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

test('cancelled automation keeps its capacity until the worker exits and then recovers', { timeout: 20000 }, async t => {
  const controller = new AbortController();
  const render = createRenderer({ clients, globalLimit: 1 });
  let blocked;
  const workers = observeWorkers(t, (worker, count) => {
    if (count === 1) worker.once('online', () => {
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

test('Shopify render capacity covers worker cleanup on cancellation, rejection, and success', { timeout: 20000 }, async t => {
  const controller = new AbortController();
  const limit = createRenderLimit({ maxTotal: 1 });
  let blocked;
  const workers = observeWorkers(t, (worker, count) => {
    if (count === 1) worker.once('online', () => {
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
