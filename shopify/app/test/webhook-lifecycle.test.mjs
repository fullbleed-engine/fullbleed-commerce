// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createRequestHandler } from 'react-router';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Use the isolated Shopify test runner.');
const db = new PrismaClient();
const primary = 'synthetic-primary.myshopify.com';
const other = 'synthetic-other.myshopify.com';
let networkRequests = 0;
const originalFetch = globalThis.fetch;
// Install before importing the SDK: its Web API adapter captures fetch on load.
globalThis.fetch = async () => {
  networkRequests++;
  return Response.json({ error: 'invalid_grant' }, { status: 401 });
};
const handler = createRequestHandler(await import('../build/server/index.js'), 'production');
const cases = [
  ['app/uninstalled', '/webhooks/app/uninstalled', { id: 1, myshopify_domain: primary }],
  ['app/scopes_update', '/webhooks/app/scopes_update', { shop_id: 'gid://shopify/Shop/1', current: ['read_orders', 'read_products'] }],
  ['shop/redact', '/webhooks/privacy', { shop_id: 1, shop_domain: primary }],
  ['customers/redact', '/webhooks/privacy', { shop_id: 1, shop_domain: primary, customer: { id: 1 }, orders_to_redact: [1] }],
  ['customers/data_request', '/webhooks/privacy', { shop_id: 1, shop_domain: primary, customer: { id: 1 }, orders_requested: [1], data_request: { id: 1 } }],
];

async function send([topic, path, payload], options = {}) {
  const body = options.body ?? JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json', 'X-Shopify-Topic': topic,
    'X-Shopify-Shop-Domain': primary, 'X-Shopify-API-Version': '2026-10',
    'X-Shopify-Webhook-Id': randomUUID(),
    'X-Shopify-Hmac-Sha256': createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(body).digest('base64'),
    ...options.headers,
  };
  return handler(new Request(`https://fullbleed-test.invalid${path}`, { method: 'POST', headers, body }));
}

test.beforeEach(async () => {
  networkRequests = 0;
  await db.privacyRequest.deleteMany(); await db.automationSettings.deleteMany();
  await db.session.deleteMany(); await db.brand.deleteMany(); await db.documentTemplate.deleteMany();
  for (const shop of [primary, other]) {
    await db.session.create({ data: { id: `offline_${shop}`, shop, state: '', isOnline: false,
      accessToken: 'synthetic-revoked-token', scope: 'read_orders', expires: new Date(Date.now() - 60000),
      refreshToken: 'synthetic-revoked-refresh-token', refreshTokenExpires: new Date(Date.now() + 86400000) } });
    await db.brand.create({ data: { shop, sellerName: 'Synthetic merchant' } });
    await db.documentTemplate.create({ data: { shop, kind: 'order-summary', content: '{}', revision: 'synthetic' } });
    await db.automationSettings.create({ data: { shop } });
    await db.automationJob.create({ data: { shop, runId: 'synthetic', handle: 'create-order-summary-link',
      orderId: 'gid://shopify/Order/1', kind: 'order-summary', requestHash: 'synthetic', ttlHours: 24,
      retryDeadline: new Date(Date.now() + 3600000), status: 'ready' } });
  }
});
test.after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });

for (const offset of [-60000, 60000]) for (const scenario of cases) {
  const [topic] = scenario;
  test(`${topic} works with ${offset < 0 ? 'expired' : 'nearly expired'} revoked tokens and no Admin API call`, async () => {
    await db.session.update({ where: { id: `offline_${primary}` }, data: { expires: new Date(Date.now() + offset) } });
    assert.equal((await send(scenario, { headers: { 'X-Shopify-Hmac-Sha256': 'invalid' } })).status, 401);
    assert.equal(await db.session.count(), 2);
    assert.equal((await send(scenario)).status, 204);
    assert.equal(networkRequests, 0, 'Webhook handling must not refresh a revoked token or fetch merchant data.');
    if (['app/uninstalled', 'shop/redact'].includes(topic)) {
      for (const table of ['session', 'brand', 'documentTemplate', 'automationSettings', 'automationJob', 'privacyRequest']) {
        assert.equal(await db[table].count({ where: { shop: primary } }), 0, table);
      }
    } else if (topic === 'app/scopes_update') {
      assert.equal((await db.session.findUniqueOrThrow({ where: { id: `offline_${primary}` } })).scope, 'read_orders,read_products');
    } else if (topic === 'customers/redact') {
      assert.equal((await db.automationJob.findFirstOrThrow({ where: { shop: primary } })).status, 'revoked');
    } else {
      assert.equal(await db.privacyRequest.count({ where: { shop: primary } }), 1);
    }
    assert.equal((await send(scenario)).status, 204, 'A duplicate delivery remains safe after session erasure.');
    assert.equal(networkRequests, 0);
    for (const table of ['session', 'brand', 'documentTemplate', 'automationSettings', 'automationJob']) {
      assert.equal(await db[table].count({ where: { shop: other } }), 1, `Preserve the other store's ${table}.`);
    }
    assert.equal((await db.session.findUniqueOrThrow({ where: { id: `offline_${other}` } })).scope, 'read_orders');
  });
}

test('webhook endpoints reject wrong topics, oversized bodies, invalid encoding and missing headers', async () => {
  for (const scenario of cases) {
    assert.equal((await send(scenario, { headers: { 'X-Shopify-Topic': 'orders/create' } })).status, 404);
    assert.equal((await send(scenario, { body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
    assert.equal((await send(scenario, { body: Buffer.from([0xff]) })).status, 400);
    assert.equal((await send(scenario, { headers: { 'X-Shopify-Webhook-Id': '' } })).status, 400);
  }
  assert.equal(await db.session.count(), 2);
  assert.equal(networkRequests, 0);
});

test('uninstall rejects a payload for a different store', async () => {
  assert.equal((await send(cases[0], { headers: { 'X-Shopify-Shop-Domain': other } })).status, 403);
  assert.equal(await db.session.count(), 2);
  assert.equal(networkRequests, 0);
});
