// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createRequestHandler } from 'react-router';
import { createFlowService, parseFlowPayload, boundedFlowRequest, pruneAutomationJobs } from '../../flow.js';
import { createRenderLimit } from '../../render-limit.js';
import { renderOrder } from '../../../src/node.js';
import { merchantAgreement } from '../../merchant-agreement.js';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Run only against the isolated synthetic webhook database.');
const db = new PrismaClient();
const otherDb = new PrismaClient();
const primary = 'synthetic-primary.myshopify.com';
const other = 'synthetic-other.myshopify.com';
const secret = process.env.SHOPIFY_API_SECRET;
const baseOrder = JSON.parse(readFileSync(new URL('../../../fixtures/order.json', import.meta.url), 'utf8'));
let time, inputOrder, renderCalls, orderReads, unavailable, slowRender, paid, catalogPriceActive, paidHandle;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const payload = (run = randomUUID(), extra = {}) => ({ shop_id: '1', shopify_domain: primary, action_run_id: run, handle: 'create-order-summary-link', properties: { order_id: 'gid://shopify/Order/1' }, ...extra });
const parsed = p => parseFlowPayload(p || payload(), primary, 'gid://shopify/Shop/1');
const loadDocument = async job => {
  orderReads++;
  assert.equal(job.shop, primary);
  if (unavailable) throw new Error('Synthetic upstream outage.');
  return { order: structuredClone(inputOrder), revision: 'revision-one', options: { kind: job.kind } };
};
const render = async (order, options) => {
  renderCalls++;
  if (slowRender) await slowRender;
  return renderOrder(order, options);
};
const serviceFor = connection => createFlowService({ db: connection, loadDocument, render, secret, appUrl: 'https://fullbleed-test.invalid', limit: createRenderLimit(), now: () => new Date(time) });
let service;

// All network traffic in request-handler tests ends at this synthetic API boundary.
process.env.SHOPIFY_PARTNER_ORG_ID = '1';
process.env.SHOPIFY_PARTNER_APP_ID = 'gid://shopify/App/1';
process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN = 'synthetic-partner-token';
process.env.SHOPIFY_PLAN_HANDLES = 'studio,scale';
process.env.SHOPIFY_APP_HANDLE = 'fullbleed-commerce';
const originalFetch = globalThis.fetch;
const price = amount => ({ presentmentMoney: { amount, currencyCode: 'USD' } });
const shopifyOrder = {
  id: 'gid://shopify/Order/1', name: '#1001', createdAt: '2026-10-02T14:00:00Z', cancelledAt: null, displayFinancialStatus: 'PAID', presentmentCurrencyCode: 'USD', edited: false, taxesIncluded: false,
  currentSubtotalPriceSet: price('90.00'), currentShippingPriceSet: price('0.00'), currentTotalTaxSet: price('4.50'), currentTotalPriceSet: price('94.50'), totalRefundedSet: price('0.00'),
  billingAddress: { name: 'Synthetic Recipient', address1: '42 Example Street' }, shippingAddress: { name: 'Synthetic Recipient', address1: '42 Example Street' },
  lineItems: { pageInfo: { hasNextPage: false }, nodes: [{ name: 'Linen notebook', sku: 'NBK', quantity: 1, discountedTotalSet: price('90.00') }] },
};
globalThis.fetch = async (resource, init) => {
  const request = new Request(resource, init);
  const url = new URL(request.url);
  const body = await request.json();
  if (url.origin === 'https://partners.shopify.com') return Response.json({ data: { activeSubscription: paid ? { shop: { id: 'gid://shopify/Shop/1', myshopifyDomain: primary }, billingPeriod: 'EVERY_30_DAYS', currentBillingCycle: { startTime: new Date(time - 86400000).toISOString(), endTime: new Date(time + 29 * 86400000).toISOString() }, items: [{ handle: paidHandle, price: { active: catalogPriceActive } }] } : null } });
  assert.equal(url.origin, `https://${primary}`, 'Tests must never reach a real store.');
  assert.equal(request.headers.get('X-Shopify-Access-Token'), 'synthetic-token');
  if (body.query.includes('FullbleedShop')) return Response.json({ data: { shop: { id: 'gid://shopify/Shop/1', name: 'Synthetic Cedar Studio', myshopifyDomain: primary, ianaTimezone: 'America/Chicago', plan: { partnerDevelopment: true } } } });
  assert.match(body.query, /FullbleedOrder/);
  assert.equal(body.variables.id, 'gid://shopify/Order/1');
  orderReads++;
  return Response.json({ data: { order: shopifyOrder } });
};
const build = await import('../build/server/index.js');
const handler = createRequestHandler(build, 'production');
async function signedRequest(path, body, valid = true, topic = null) {
  const text = JSON.stringify(body);
  return handler(new Request(`https://fullbleed-test.invalid${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': valid ? createHmac('sha256', secret).update(text).digest('base64') : 'invalid',
    ...(topic ? { 'X-Shopify-Topic': topic, 'X-Shopify-Shop-Domain': primary, 'X-Shopify-API-Version': '2026-10', 'X-Shopify-Webhook-Id': randomUUID() } : {}),
  }, body: text }));
}
async function readyJob(svc = service) {
  await svc.setEnabled(primary, true);
  const job = await svc.accept(parsed());
  await svc.start(job.id);
  const ready = await db.automationJob.findUnique({ where: { id: job.id } });
  assert.equal(ready.status, 'ready');
  return ready;
}
const linkToken = async job => new URL((await service.status(job).json()).return_value.downloadUrl).hash.slice(1);

test.beforeEach(async () => {
  await db.agreementAcceptance.deleteMany();
  await db.accessEvent.deleteMany();
  await db.automationSettings.deleteMany(); await db.session.deleteMany(); await db.brand.deleteMany(); await db.documentTemplate.deleteMany(); await db.usagePeriod.deleteMany();
  await db.session.createMany({ data: [primary, other].map(shop => ({ id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-token', scope: 'read_orders' })) });
  await db.agreementAcceptance.createMany({ data: [primary, other].map(shop => ({ shop, version: merchantAgreement.version, documentSha256: merchantAgreement.documentSha256, actorId: '42' })) });
  time = Date.now(); inputOrder = structuredClone(baseOrder); renderCalls = 0; orderReads = 0; unavailable = false; slowRender = null; paid = true; catalogPriceActive = true;
  paidHandle = 'studio';
  service = serviceFor(db);
});

test('Flow payload validation binds store, action, order and bounded lifetime', async () => {
  for (const value of [payload(undefined, { shopify_domain: other }), payload(undefined, { shop_id: '2' }), payload(undefined, { handle: 'toString' }), payload(undefined, { properties: { order_id: 'https://external.invalid' } }), ...[-1, 73, 1.5, '24', false].map(expires_in_hours => payload(undefined, { properties: { order_id: 'gid://shopify/Order/1', expires_in_hours } }))]) assert.throws(() => parsed(value), error => error instanceof Response && error.status < 500);
  const request = new Request('https://fullbleed-test.invalid/api/flow/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(17000) }) });
  await assert.rejects(boundedFlowRequest(request), error => error.status === 413);
  assert.equal(parsed().ttlHours, 24);
  assert.equal(parsed(payload(undefined, { properties: { order_id: 'gid://shopify/Order/1', expires_in_hours: 0 } })).ttlHours, 24);
});

test('duplicate action runs and competing database clients produce one verified document', async () => {
  const input = parsed();
  await assert.rejects(service.accept(input), error => error.status === 409);
  await service.setEnabled(primary, true);
  const job = await service.accept(input);
  assert.equal((await service.accept(input)).id, job.id);
  const changed = parsed(payload(input.runId, { properties: { order_id: 'gid://shopify/Order/2' } }));
  await assert.rejects(service.accept(changed), error => error.status === 409);
  await Promise.all([service.start(job.id), serviceFor(otherDb).start(job.id)]);
  assert.equal(renderCalls, 1);
  assert.equal(await db.automationJob.count(), 1);
  const ready = await db.automationJob.findUnique({ where: { id: job.id } });
  assert.equal(ready.status, 'ready'); assert.equal(ready.attempts, 1);
  const first = await service.status(ready).json();
  const second = await serviceFor(otherDb).status(ready).json();
  assert.deepEqual(first, second);
  assert.equal(new URL(first.return_value.downloadUrl).search, '');
  assert.doesNotMatch(JSON.stringify(ready), /%PDF-|Example Street|Cedar & Form/);
});

test('expired process lease resumes after restart and transient failures back off durably', async () => {
  await service.setEnabled(primary, true);
  const job = await service.accept(parsed());
  await db.automationJob.update({ where: { id: job.id }, data: { status: 'running', attempts: 1, leaseId: randomUUID(), leaseUntil: new Date(time - 1) } });
  unavailable = true;
  await serviceFor(otherDb).start(job.id);
  let record = await db.automationJob.findUnique({ where: { id: job.id } });
  assert.equal(record.status, 'retry-wait'); assert.equal(record.attempts, 2);
  assert.equal(service.status(record).status, 429);
  await service.start(job.id); assert.equal((await db.automationJob.findUnique({ where: { id: job.id } })).attempts, 2);
  time = record.nextAttemptAt.valueOf() + 1; unavailable = false;
  await serviceFor(otherDb).start(job.id);
  record = await db.automationJob.findUnique({ where: { id: job.id } });
  assert.equal(record.status, 'ready'); assert.equal(record.attempts, 3);
});

test('local capacity waits do not spend preparation attempts and survive restart', async () => {
  const limit = createRenderLimit({ maxTotal: 1 });
  const makeService = () => createFlowService({ db, loadDocument, render, secret, appUrl: 'https://fullbleed-test.invalid', limit, now: () => new Date(time) });
  let queued = makeService();
  await queued.setEnabled(primary, true);
  const job = await queued.accept(parsed());
  let release;
  const occupied = limit(other, () => new Promise(resolve => { release = resolve; }));
  try {
    for (let i = 0; i < 10; i++) {
      await queued.start(job.id);
      const waiting = await db.automationJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(waiting.status, 'retry-wait');
      assert.equal(waiting.attempts, 0, 'Admission waits must not exhaust actual preparation attempts.');
      assert.equal(waiting.lastError, 'capacity_wait');
      assert.equal(waiting.leaseId, null);
      assert.equal(waiting.leaseUntil, null);
      assert.equal(queued.status(waiting).status, 429);
      assert.equal(renderCalls, 0); assert.equal(orderReads, 0);
      time = waiting.nextAttemptAt.valueOf() + 1;
      if (i === 4) queued = makeService();
    }
  } finally { release(); await occupied; }
  await queued.start(job.id);
  const ready = await db.automationJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(ready.status, 'ready'); assert.equal(ready.attempts, 1);
  assert.equal(renderCalls, 1); assert.equal(ready.lastError, null);
});

test('capacity deferral preserves pause and competing leases and still respects the deadline', async () => {
  const makeService = limit => createFlowService({ db, loadDocument, render, secret, appUrl: 'https://fullbleed-test.invalid', limit, now: () => new Date(time) });
  await service.setEnabled(primary, true);
  const paused = await service.accept(parsed());
  await makeService(async () => {
    await service.setEnabled(primary, false);
    throw new Response(null, { status: 429 });
  }).start(paused.id);
  assert.equal((await db.automationJob.findUniqueOrThrow({ where: { id: paused.id } })).status, 'revoked');

  await service.setEnabled(primary, true);
  const competing = await service.accept(parsed());
  const competingLease = randomUUID();
  await makeService(async () => {
    await db.automationJob.update({ where: { id: competing.id }, data: { status: 'running', attempts: 1, leaseId: competingLease, leaseUntil: new Date(time + 90000) } });
    throw new Response(null, { status: 429 });
  }).start(competing.id);
  assert.equal((await db.automationJob.findUniqueOrThrow({ where: { id: competing.id } })).leaseId, competingLease);

  const expired = await service.accept(parsed());
  const busy = makeService(async () => { throw new Response(null, { status: 429 }); });
  time = expired.retryDeadline.valueOf() - 1000;
  await busy.start(expired.id);
  const waiting = await db.automationJob.findUniqueOrThrow({ where: { id: expired.id } });
  assert.equal(waiting.nextAttemptAt.valueOf(), expired.retryDeadline.valueOf());
  time = expired.retryDeadline.valueOf();
  await busy.start(expired.id);
  const ended = await db.automationJob.findUniqueOrThrow({ where: { id: expired.id } });
  assert.equal(ended.status, 'failed'); assert.equal(ended.attempts, 0);
  assert.equal(ended.lastError, 'retry_limit'); assert.equal(orderReads, 0); assert.equal(renderCalls, 0);
});

test('upstream throttling still counts as an attempted preparation', async () => {
  const throttled = createFlowService({ db, render, secret, appUrl: 'https://fullbleed-test.invalid', limit: createRenderLimit(), now: () => new Date(time),
    loadDocument: async () => { throw new Response(null, { status: 429 }); },
  });
  await throttled.setEnabled(primary, true);
  const job = await throttled.accept(parsed());
  await throttled.start(job.id);
  const waiting = await db.automationJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(waiting.status, 'retry-wait'); assert.equal(waiting.attempts, 1);
  assert.equal(waiting.lastError, 'temporarily_unavailable');
  assert.equal(waiting.nextAttemptAt.valueOf(), time + 15000);
});

test('Flow exposes ready links only after accounting commits and preserves failure or revocation', async () => {
  for (const outcome of ['commit', 'reject', 'pause']) {
    let release, rendered;
    const gate = new Promise(resolve => { release = resolve; });
    const afterRender = new Promise(resolve => { rendered = resolve; });
    const metered = createFlowService({ db, render, secret, appUrl: 'https://fullbleed-test.invalid', limit: createRenderLimit(), now: () => new Date(time),
      withDocument: async (job, signal, work) => {
        const result = await work(await loadDocument(job, signal));
        rendered();
        await gate;
        if (outcome === 'reject') throw new Response(null, { status: 409 });
        return result;
      },
    });
    await metered.setEnabled(primary, true);
    const job = await metered.accept(parsed());
    const work = metered.start(job.id);
    await afterRender;
    const pending = await db.automationJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(pending.status, 'running');
    assert.equal(metered.status(pending).status, 202);
    assert.equal(pending.pdfSha256, null);
    if (outcome === 'pause') await metered.setEnabled(primary, false);
    release();
    await work;
    const finished = await db.automationJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(finished.status, outcome === 'commit' ? 'ready' : outcome === 'reject' ? 'failed' : 'revoked');
    assert.equal(metered.status(finished).status, outcome === 'commit' ? 200 : outcome === 'reject' ? 422 : 410);
    if (outcome !== 'commit') assert.equal(finished.pdfSha256, null);
  }
});

test('verified downloads use exact bytes, reject forged/expired links and invalidate changed content', async () => {
  const job = await readyJob(); const token = await linkToken(job);
  const reads = orderReads;
  assert.equal((await service.download(job.id, 'a'.repeat(43))).status, 404); assert.equal(orderReads, reads);
  const response = await service.download(job.id, token);
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(sha(bytes), job.pdfSha256);
  mkdirSync(resolve('../../output/shopify/flow'), { recursive: true }); writeFileSync(resolve('../../output/shopify/flow/order-summary.pdf'), bytes);
  const stored = await db.automationJob.findUnique({ where: { id: job.id } }); assert.equal(stored.downloads, 1);
  inputOrder.shipping.name = 'Changed synthetic recipient';
  assert.equal((await service.download(job.id, token)).status, 410);
  assert.equal((await db.automationJob.findUnique({ where: { id: job.id } })).status, 'stale');
  time = job.expiresAt.valueOf() + 1; assert.equal(service.status(job).status, 410);
});

test('pause, revoke and uninstall win races with an in-progress render', async () => {
  await service.setEnabled(primary, true);
  const job = await service.accept(parsed());
  let release; slowRender = new Promise(resolve => { release = resolve; });
  const work = service.start(job.id);
  while (!renderCalls) await new Promise(resolve => setTimeout(resolve, 10));
  await service.revoke(other, job.id); assert.equal((await db.automationJob.findUnique({ where: { id: job.id } })).status, 'running');
  await service.setEnabled(primary, false); release(); await work;
  assert.equal((await db.automationJob.findUnique({ where: { id: job.id } })).status, 'revoked');
  slowRender = null;
  const next = await readyJob();
  const token = await linkToken(next);
  const response = await signedRequest('/webhooks/app/uninstalled', {}, true, 'app/uninstalled');
  assert.equal(response.status, 204); assert.equal(await db.automationJob.count(), 0);
  assert.equal((await service.download(next.id, token)).status, 404);
});

test('retry bounds stop unattended work and explicit retry preserves original history time', async () => {
  await service.setEnabled(primary, true);
  const job = await service.accept(parsed());
  await db.automationJob.update({ where: { id: job.id }, data: { attempts: 8 } });
  await service.start(job.id);
  assert.equal((await db.automationJob.findUnique({ where: { id: job.id } })).status, 'failed'); assert.equal(renderCalls, 0);
  await service.retry(primary, job.id); await service.start(job.id);
  const retried = await db.automationJob.findUnique({ where: { id: job.id } });
  assert.equal(retried.status, 'ready'); assert.equal(retried.createdAt.valueOf(), job.createdAt.valueOf());
});

test('real request handler verifies Flow HMAC, retained-price access, preparation and PDF download', async () => {
  const body = payload();
  assert.equal((await signedRequest('/api/flow/documents', body, false)).status, 400);
  assert.equal(await db.automationJob.count(), 0); assert.equal(orderReads, 0);
  await service.setEnabled(primary, true);
  paid = false;
  assert.equal((await signedRequest('/api/flow/documents', body)).status, 402);
  assert.equal(await db.automationJob.count(), 0); assert.equal(orderReads, 0);
  paid = true;
  catalogPriceActive = false; // Existing subscription remains active at its original price.
  assert.equal((await signedRequest('/api/flow/documents', body)).status, 202);
  let job;
  for (let i = 0; i < 200; i++) {
    job = await db.automationJob.findFirst({ where: { runId: body.action_run_id } });
    if (job?.status === 'ready' || job?.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(job.status, 'ready', JSON.stringify({ status: job.status, error: job.lastError }));
  const preparedAccess = await db.accessEvent.findFirstOrThrow({ where: { jobId: job.id, operation: 'flow.prepare' } });
  assert.equal(preparedAccess.actorType, 'flow'); assert.equal(preparedAccess.actorId, body.action_run_id); assert.equal(preparedAccess.outcome, 'completed');
  const replay = await signedRequest('/api/flow/documents', body);
  assert.equal(replay.status, 200);
  const output = (await replay.json()).return_value;
  const url = new URL(output.downloadUrl); const token = url.hash.slice(1); url.hash = '';
  const landing = await handler(new Request(url));
  assert.match(landing.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.doesNotMatch(await landing.text(), /Synthetic Recipient|Example Street/);
  const denied = await handler(new Request(url, { method: 'POST' })); assert.equal(denied.status, 404);
  const pdf = await handler(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
  assert.equal(pdf.status, 200); assert.equal(sha(Buffer.from(await pdf.arrayBuffer())), output.sha256);
  const linkAccess = await db.accessEvent.findFirstOrThrow({ where: { jobId: job.id, operation: 'document.download' } });
  assert.equal(linkAccess.actorType, 'document_link'); assert.equal(linkAccess.actorId, job.id); assert.equal(linkAccess.outcome, 'completed');
  assert.doesNotMatch(JSON.stringify(await db.accessEvent.findMany()), new RegExp(`${token}|Synthetic Recipient|Example Street|synthetic-token`));
  const receipt = await db.agreementAcceptance.findUniqueOrThrow({ where: { shop: primary } });
  await db.agreementAcceptance.delete({ where: { shop: primary } });
  const readsBeforeRenewal = orderReads;
  assert.equal((await handler(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }))).status, 503);
  assert.equal((await signedRequest('/api/flow/documents', body)).status, 428);
  assert.equal(orderReads, readsBeforeRenewal, 'An existing link and Flow replay must not read an order without current acceptance.');
  await db.agreementAcceptance.create({ data: receipt });
  paid = false;
  assert.equal((await handler(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }))).status, 503);
  paid = true;
  await db.brand.create({ data: { shop: primary, sellerName: 'Synthetic Cedar Studio', footer: 'Changed after preparation.' } });
  assert.equal((await handler(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }))).status, 410);
  assert.equal(await db.automationJob.count(), 1);
  assert.equal((await db.usagePeriod.findFirst()).used, 1);
  assert.equal(await db.usageOrder.count(), 1);
});

async function adminRequest(path, body) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: `https://${primary}/admin`, dest: `https://${primary}`, aud: process.env.SHOPIFY_API_KEY, sub: '1', exp: now + 60, nbf: now - 1, iat: now, jti: randomUUID(), sid: randomUUID() })).toString('base64url');
  const token = `${header}.${claims}.${createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url')}`;
  return handler(new Request(`https://fullbleed-test.invalid${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
}

test('authenticated manual and template endpoints share order usage and upgrade without resetting it', async () => {
  const manual = await adminRequest('/app/pdf?order=gid://shopify/Order/1');
  assert.equal(manual.status, 200); assert.match(manual.headers.get('Content-Type'), /application\/pdf/);
  const packing = await adminRequest('/app/pdf?order=gid://shopify/Order/1&kind=packing-slip');
  assert.equal(packing.status, 200);
  const preview = await adminRequest('/app/template', { intent: 'preview', order: 'gid://shopify/Order/1', kind: 'order-summary', template: { schema: 'fullbleed.commerce-template.v1', html: '<h1>{{order.number}}</h1><p>{{document.title}}</p>', css: 'h1 { color: #244a40; }' } });
  assert.equal(preview.status, 200, await preview.clone().text().then(s => s.slice(0, 150)));
  const staffEvents = await db.accessEvent.findMany({ where: { shop: primary } });
  assert.equal(staffEvents.length, 3); assert.ok(staffEvents.every(event => event.actorType === 'staff' && event.actorId === '1' && event.outcome === 'completed'));
  assert.equal(staffEvents.filter(event => event.operation === 'template.preview').length, 1);
  const row = await db.usagePeriod.findFirst();
  assert.equal(row.used, 1);
  await db.usagePeriod.update({ where: { id: row.id }, data: { used: 250 } });
  const denied = await adminRequest('/app/pdf?order=gid://shopify/Order/2');
  assert.equal(denied.status, 409); assert.equal(denied.headers.get('X-Fullbleed-Error'), 'usage_limit');
  const deniedPreview = await adminRequest('/app/template', { intent: 'preview', order: 'gid://shopify/Order/2', kind: 'order-summary', template: { schema: 'fullbleed.commerce-template.v1', html: '<h1>{{order.number}}</h1>', css: '' } });
  assert.equal(deniedPreview.status, 409); assert.equal(deniedPreview.headers.get('X-Fullbleed-Error'), 'usage_limit');
  assert.equal((await adminRequest('/app/pdf?order=gid://shopify/Order/1')).status, 200);
  const page = await adminRequest('/app/plans');
  assert.equal(page.status, 200); assert.match((await page.text()).replace(/<!--.*?-->/g, ''), /250 orders used/);
  paidHandle = 'scale';
  const upgraded = await adminRequest('/app/plans');
  const html = await upgraded.text();
  assert.equal(upgraded.status, 200); assert.match(html, /Scale/); assert.match(html, /750/);
  assert.equal((await db.usagePeriod.findFirst()).used, 250);
  assert.equal(await db.usagePeriod.count(), 1);
});

test('Flow reports a quota action and can prepare after an upgrade without hidden charges', async () => {
  await service.setEnabled(primary, true);
  const startsAt = new Date(time - 86400000), endsAt = new Date(time + 29 * 86400000);
  await db.usagePeriod.create({ data: { shop: primary, key: `cycle:${startsAt.toISOString()}`, startsAt, endsAt, used: 250 } });
  const body = payload();
  assert.equal((await signedRequest('/api/flow/documents', body)).status, 202);
  let job;
  for (let i = 0; i < 200; i++) {
    job = await db.automationJob.findFirst({ where: { runId: body.action_run_id } });
    if (job?.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(job.lastError, 'usage_limit'); assert.equal(orderReads, 0);
  const stopped = await signedRequest('/api/flow/documents', body);
  assert.equal(stopped.status, 422); assert.match(await stopped.text(), /Plan and usage/);
  paidHandle = 'scale';
  const next = payload();
  assert.equal((await signedRequest('/api/flow/documents', next)).status, 202);
  for (let i = 0; i < 200; i++) {
    job = await db.automationJob.findFirst({ where: { runId: next.action_run_id } });
    if (job?.status === 'ready') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(job.status, 'ready');
  assert.equal((await db.usagePeriod.findFirst()).used, 251);
});

test('customer redaction removes only matching store order references and invalidates links', async () => {
  const job = await readyJob();
  await service.setEnabled(other, true);
  await db.automationJob.create({ data: { ...parsed(), shop: other, runId: 'other-run', retryDeadline: new Date(time + 10000) } });
  const response = await signedRequest('/webhooks/privacy', { shop_domain: primary, shop_id: 1, orders_to_redact: [1], customer: { id: 1 } }, true, 'customers/redact');
  assert.equal(response.status, 204);
  assert.equal(await db.automationJob.count({ where: { shop: primary, orderId: 'gid://shopify/Order/1' } }), 0);
  assert.equal(await db.automationJob.count({ where: { shop: other } }), 1);
  assert.equal((await service.download(job.id, await linkToken(job))).status, 404);
  const replay = await service.accept(parsed(payload(job.runId)));
  assert.equal(replay.id, job.id); assert.equal(replay.status, 'revoked'); assert.equal(replay.orderId, '');
  assert.equal(replay.requestHash, '');
  assert.equal(service.status(replay).status, 410);
  const alteredReplay = await service.accept(parsed(payload(job.runId, { properties: { order_id: 'gid://shopify/Order/999' } })));
  assert.equal(service.status(alteredReplay).status, 410);
  assert.equal(await db.automationJob.count({ where: { shop: primary } }), 1);
  await db.automationJob.update({ where: { id: job.id }, data: { createdAt: new Date(time - 31 * 24 * 3600000) } });
  assert.equal((await pruneAutomationJobs(db, new Date(time))).count, 1);
  assert.equal(await db.automationJob.count(), 1);
});

test.after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); await otherDb.$disconnect(); });
