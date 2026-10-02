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

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Run only against the isolated synthetic webhook database.');
const db = new PrismaClient();
const otherDb = new PrismaClient();
const primary = 'synthetic-primary.myshopify.com';
const other = 'synthetic-other.myshopify.com';
const secret = process.env.SHOPIFY_API_SECRET;
const baseOrder = JSON.parse(readFileSync(new URL('../../../fixtures/order.json', import.meta.url), 'utf8'));
let time, inputOrder, renderCalls, orderReads, unavailable, slowRender, paid;
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
process.env.SHOPIFY_PLAN_HANDLES = 'automation';
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
  if (url.origin === 'https://partners.shopify.com') return Response.json({ data: { activeSubscription: paid ? { shop: { id: 'gid://shopify/Shop/1', myshopifyDomain: primary }, items: [{ handle: 'automation', price: { active: true } }] } : null } });
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
  await db.automationSettings.deleteMany(); await db.session.deleteMany(); await db.brand.deleteMany(); await db.documentTemplate.deleteMany();
  await db.session.createMany({ data: [primary, other].map(shop => ({ id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-token', scope: 'read_orders' })) });
  time = Date.now(); inputOrder = structuredClone(baseOrder); renderCalls = 0; orderReads = 0; unavailable = false; slowRender = null; paid = true;
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

test('real request handler verifies Flow HMAC, paid access, persistent preparation and PDF download', async () => {
  const body = payload();
  assert.equal((await signedRequest('/api/flow/documents', body, false)).status, 400);
  assert.equal(await db.automationJob.count(), 0); assert.equal(orderReads, 0);
  await service.setEnabled(primary, true);
  paid = false;
  assert.equal((await signedRequest('/api/flow/documents', body)).status, 402);
  assert.equal(await db.automationJob.count(), 0); assert.equal(orderReads, 0);
  paid = true;
  assert.equal((await signedRequest('/api/flow/documents', body)).status, 202);
  let job;
  for (let i = 0; i < 200; i++) {
    job = await db.automationJob.findFirst({ where: { runId: body.action_run_id } });
    if (job?.status === 'ready' || job?.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(job.status, 'ready', JSON.stringify({ status: job.status, error: job.lastError }));
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
  paid = false;
  assert.equal((await handler(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }))).status, 503);
  assert.equal(await db.automationJob.count(), 1);
});

test('customer redaction removes only matching store order references and invalidates links', async () => {
  const job = await readyJob();
  await service.setEnabled(other, true);
  await db.automationJob.create({ data: { ...parsed(), shop: other, runId: 'other-run', retryDeadline: new Date(time + 10000) } });
  const response = await signedRequest('/webhooks/privacy', { orders_to_redact: [1], customer: { id: 1 } }, true, 'customers/redact');
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
