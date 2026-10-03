// SPDX-License-Identifier: MIT
// Synthetic service workload. Shopify network and Flow polling are simulated;
// rendering, admission, SQLite jobs and downloads use the actual implementation.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createFlowService, parseFlowPayload } from '../shopify/flow.js';
import { createRenderLimit } from '../shopify/render-limit.js';
import { renderOrder } from '../src/node.js';
import { starterTemplate } from '../src/documents.js';

assert.match(process.env.DATABASE_URL || '', /^file:.*[/\\]capacity-test\.sqlite$/, 'Use the isolated capacity-test.sqlite database.');
const container = process.argv.includes('--container');
const root = new URL('../', import.meta.url);
const output = resolve(process.env.FULLBLEED_CAPACITY_OUTPUT || 'output/capacity');
mkdirSync(output, { recursive: true });
const sha = data => createHash('sha256').update(data).digest('hex');
const read = path => readFileSync(path, 'utf8');
const cgroup = name => read(`/sys/fs/cgroup/${name}`).trim();
const counters = name => Object.fromEntries(cgroup(name).split('\n').map(line => { const [key, value] = line.split(' '); return [key, Number(value)]; }));
const resourceStart = container ? { cpu: counters('cpu.stat'), events: counters('memory.events') } : null;
if (container) {
  assert.equal(cgroup('cpu.max'), '50000 100000');
  assert.equal(cgroup('memory.max'), '536870912');
  assert.equal(process.getuid(), 1000);
}
const require = createRequire(new URL('../shopify/app/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const checks = [];
const passed = name => { checks.push({ name, passed: true }); console.log(`capacity: ${name}`); };
const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
const timing = values => ({ samples: values.length, medianMs: Math.round(percentile(values, 0.5)), p95Ms: Math.round(percentile(values, 0.95)), maxMs: Math.round(Math.max(0, ...values)) });
const base = JSON.parse(read(new URL('fixtures/order.json', root)));
const long = structuredClone(base);
long.number = 'LONG-1043';
long.items = Array.from({ length: 60 }, (_, i) => ({ name: `Item ${String(i + 1).padStart(3, '0')} / A carefully woven linen textile with a detailed description of its finish, texture and care. This is a deliberately long product title to check wrapping across multiple lines.`, sku: `LONG-${String(i + 1).padStart(3, '0')}`, quantity: '1', total: '$10.00' }));
long.totals = [{ label: 'Total', amount: '$600.00', emphasis: true }];
const maximum = structuredClone(base);
maximum.number = 'CAPACITY-250';
maximum.items = Array.from({ length: 250 }, (_, i) => ({ name: `Synthetic item ${String(i + 1).padStart(3, '0')}`, sku: `CAP-${String(i + 1).padStart(3, '0')}`, quantity: '1', total: '$10.00' }));
maximum.totals = [{ label: 'Total', amount: '$2,500.00', emphasis: true }];
const custom = starterTemplate();
custom.html = '<h2>THE PERSONAL EDITION</h2>' + custom.html;
custom.css += '\nh2 { font-family: Bebas Neue; font-size: 14pt; color: #c5542d; }';
const cases = [
  { name: 'studio-order-summary', order: base, options: { kind: 'order-summary' } },
  { name: 'studio-packing-slip', order: base, options: { kind: 'packing-slip' } },
  { name: 'long-order-summary', order: long, options: { kind: 'order-summary' } },
  { name: 'long-packing-slip', order: long, options: { kind: 'packing-slip' } },
  { name: 'maximum-items-summary', order: maximum, options: { kind: 'order-summary' } },
  { name: 'custom-order-summary', order: base, options: { kind: 'order-summary', template: custom } },
];
const run = randomUUID().slice(0, 8);
const shops = Array.from({ length: 4 }, (_, i) => `synthetic-capacity-${run}-${i + 1}.myshopify.com`);
const ids = new Map(cases.map((item, i) => [`gid://shopify/Order/${i + 1}`, item]));
const documents = [], renderTimes = [], downloadTimes = [], healthTimes = [];
let active = 0, peakActive = 0, renderCalls = 0, probeErrors = 0, probing = false;
let stopProbing = false, probe;
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
const start = performance.now();
const cpuStart = process.cpuUsage();
const limit = createRenderLimit();
const service = createFlowService({ db, secret: 'synthetic-capacity-document-secret', appUrl: 'https://capacity-test.invalid', limit,
  async loadDocument(job) {
    assert.ok(shops.includes(job.shop));
    const input = ids.get(job.orderId); assert.ok(input);
    assert.equal(input.options.kind, job.kind);
    return { order: input.order, options: input.options, revision: 'synthetic-capacity-revision' };
  },
  async render(order, options) {
    active++; peakActive = Math.max(peakActive, active); renderCalls++;
    const begin = performance.now();
    try { return await renderOrder(order, options); }
    finally { renderTimes.push(performance.now() - begin); active--; }
  },
});

try {
  for (const model of ['session', 'automationSettings', 'automationJob', 'brand', 'documentTemplate', 'privacyRequest']) assert.equal(await db[model].count(), 0, 'Capacity database must start empty.');
  if (container) {
    probing = true;
    probe = (async () => {
      while (!stopProbing) {
        const begin = performance.now();
        try {
          const response = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(3000) });
          assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ok' });
          healthTimes.push(performance.now() - begin);
        } catch { probeErrors++; }
        await setTimeout(100);
      }
    })();
  }
  eventLoop.enable();
  for (const item of cases) {
    const began = performance.now();
    const result = await renderOrder(item.order, item.options);
    assert.equal(result.missingGlyphs, 0); assert.ok(result.pages >= 1 && result.pages <= 30);
    item.sha256 = sha(result.pdf);
    writeFileSync(resolve(output, `${item.name}.pdf`), result.pdf);
    documents.push({ name: item.name, items: item.order.items.length, pages: result.pages, bytes: result.pdf.length, sha256: item.sha256, engineVersion: result.engineVersion, baselineMs: Math.round(performance.now() - began) });
  }
  passed('six real document cases render, including long orders, 250 items and custom HTML/CSS');
  for (const shop of shops) {
    await db.session.create({ data: { id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-capacity-token', scope: 'read_orders' } });
    await service.setEnabled(shop, true);
  }
  const jobs = [];
  for (const [i, item] of cases.entries()) for (const [s, shop] of shops.entries()) {
    const input = parseFlowPayload({ shop_id: s + 1, shopify_domain: shop, action_run_id: `capacity-${i}-${s}`, handle: item.options.kind === 'packing-slip' ? 'create-packing-slip-link' : 'create-order-summary-link', properties: { order_id: `gid://shopify/Order/${i + 1}` } }, shop, `gid://shopify/Shop/${s + 1}`);
    jobs.push(await service.accept(input));
  }
  const burstStart = performance.now();
  const deadline = Date.now() + 150000;
  let capacityWaitObservations = 0, rounds = 0;
  for (;;) {
    const pending = await db.automationJob.findMany({ where: { status: { not: 'ready' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    if (!pending.length) break;
    assert.ok(Date.now() < deadline, 'Synthetic burst did not drain within 150 seconds.');
    assert.ok(pending.every(job => ['pending', 'retry-wait'].includes(job.status)), 'No terminal failure or abandoned lease is allowed.');
    const due = pending.filter(job => !job.nextAttemptAt || job.nextAttemptAt <= new Date());
    if (due.length) {
      rounds++;
      await Promise.all(due.map(job => service.start(job.id)));
      const waiting = await db.automationJob.findMany({ where: { lastError: 'capacity_wait' } });
      capacityWaitObservations += waiting.length;
      assert.ok(waiting.every(job => job.attempts === 0 && job.leaseId === null));
    }
    await setTimeout(100);
  }
  const burstMs = Math.round(performance.now() - burstStart);
  const ready = await db.automationJob.findMany();
  assert.equal(ready.length, 24); assert.equal(renderCalls, 24); assert.equal(peakActive, 2);
  assert.ok(capacityWaitObservations > 0 && ready.every(job => job.attempts === 1));
  for (const job of ready) assert.equal(job.pdfSha256, ids.get(job.orderId).sha256);
  passed('24 simultaneous jobs across four stores drain with exactly one preparation each and at most two renders');
  passed('capacity waits retain zero attempts and all prepared PDFs match their baselines');
  let exampleLink;
  for (const job of ready) {
    const outputValue = (await service.status(job).json()).return_value;
    const token = new URL(outputValue.downloadUrl).hash.slice(1);
    const began = performance.now();
    const response = await service.download(job.id, token);
    downloadTimes.push(performance.now() - began);
    assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(sha(Buffer.from(await response.arrayBuffer())), job.pdfSha256);
    exampleLink = { job, token };
  }
  assert.equal(renderCalls, 48);
  assert.equal(await db.automationJob.count({ where: { downloads: 1 } }), 24);
  passed('all 24 private download responses reproduce exact prepared PDF bytes');
  for (const shop of shops) await service.setEnabled(shop, false);
  assert.equal((await service.download(exampleLink.job.id, exampleLink.token)).status, 410);
  passed('pause revokes the prepared burst after download verification');
  stopProbing = true; await probe; eventLoop.disable();
  if (container) {
    assert.ok(healthTimes.length > 10 && probeErrors === 0);
    const events = counters('memory.events');
    assert.equal(events.oom_kill, resourceStart.events.oom_kill);
    assert.equal(events.oom, resourceStart.events.oom);
    passed('co-resident production HTTP health remains available with no cgroup out-of-memory events');
  }
  const cpu = process.cpuUsage(cpuStart);
  const sourceFiles = ['src/node.js', 'src/documents.js', 'src/templates.js', 'shopify/flow.js', 'shopify/render-limit.js', 'tools/check-flow-capacity.mjs'];
  const result = {
    checkedAt: new Date().toISOString(), syntheticOnly: true, node: process.version,
    sourceSha256: Object.fromEntries(sourceFiles.map(file => [file, sha(readFileSync(new URL(file, root)))])),
    limits: container ? { cpu: cgroup('cpu.max'), memoryBytes: Number(cgroup('memory.max')), cgroupMemoryPeakBytes: Number(cgroup('memory.peak')), cpuCountersBefore: resourceStart.cpu, cpuCountersAfter: counters('cpu.stat') } : null,
    processPeakRssKiB: process.resourceUsage().maxRSS, processCpuMs: Math.round((cpu.user + cpu.system) / 1000),
    elapsedMs: Math.round(performance.now() - start), burst: { jobs: ready.length, shops: shops.length, elapsedMs: burstMs, preparationCalls: 24, peakConcurrentRenders: peakActive, retryRounds: rounds, capacityWaitObservations },
    rendering: timing(renderTimes), downloads: timing(downloadTimes), httpHealth: { enabled: probing, errors: probeErrors, ...timing(healthTimes) },
    eventLoop: { p95Ms: Math.round(eventLoop.percentile(95) / 1e6), maxMs: Math.round(eventLoop.max / 1e6) }, documents, checks,
    scope: 'Real service, limiter, SQLite and rendering with synthetic order access and locally simulated Flow polling. HTTP checks cover co-resident readiness, not authenticated Shopify traffic. A finite workload, not a production throughput or latency guarantee.',
  };
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ jobs: ready.length, burstMs, renders: renderCalls, peakActive, healthErrors: probeErrors }));
} finally {
  stopProbing = true; await probe; eventLoop.disable();
  await db.automationSettings.deleteMany({ where: { shop: { in: shops } } });
  await db.session.deleteMany({ where: { shop: { in: shops } } });
  await db.$disconnect();
}
