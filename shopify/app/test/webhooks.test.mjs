import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createRequestHandler } from 'react-router';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Run only against the isolated synthetic webhook database.');
const build = await import('../build/server/index.js');
const handler = createRequestHandler(build, 'production');
const db = new PrismaClient();
const primary = 'synthetic-primary.myshopify.com';
const other = 'synthetic-other.myshopify.com';

async function webhook(path, topic, shop, payload, valid = true) {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(body).digest('base64');
  return handler(new Request(`https://fullbleed-test.invalid${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Shopify-Topic': topic,
    'X-Shopify-Shop-Domain': shop, 'X-Shopify-API-Version': '2026-10',
    'X-Shopify-Hmac-Sha256': valid ? signature : 'invalid',
    'X-Shopify-Webhook-Id': '00000000-0000-4000-8000-000000000001',
  }, body }));
}

test('production request handler authenticates webhooks and isolates shop deletion', async () => {
  await db.brand.deleteMany(); await db.session.deleteMany();
  await db.brand.createMany({ data: [{ shop: primary, sellerName: 'Synthetic primary' }, { shop: other, sellerName: 'Synthetic other' }] });
  await db.session.createMany({ data: [primary, other].map(shop => ({ id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-token', scope: 'read_orders' })) });
  const denied = await webhook('/webhooks/privacy', 'shop/redact', primary, { shop_domain: primary, shop_id: 1 }, false);
  assert.equal(denied.status, 401);
  assert.equal(await db.brand.count(), 2);
  const customer = await webhook('/webhooks/privacy', 'customers/redact', primary, { shop_domain: primary, shop_id: 1, customer: { id: 1 }, orders_to_redact: [] });
  assert.equal(customer.status, 204);
  assert.equal(await db.brand.count(), 2);
  const redacted = await webhook('/webhooks/privacy', 'shop/redact', primary, { shop_domain: primary, shop_id: 1 });
  assert.equal(redacted.status, 204);
  assert.equal(await db.brand.count({ where: { shop: primary } }), 0);
  assert.equal(await db.session.count({ where: { shop: primary } }), 0);
  assert.equal(await db.brand.count({ where: { shop: other } }), 1);
  assert.equal(await db.session.count({ where: { shop: other } }), 1);
  assert.equal((await webhook('/webhooks/privacy', 'shop/redact', primary, { shop_domain: primary, shop_id: 1 })).status, 204);
  await db.session.deleteMany({ where: { shop: other } });
  assert.equal((await webhook('/webhooks/app/uninstalled', 'app/uninstalled', other, {})).status, 204);
  assert.equal(await db.brand.count(), 0);
});

test('unauthenticated PDF requests never return customer documents', async () => {
  const response = await handler(new Request('https://fullbleed-test.invalid/app/pdf?order=gid://shopify/Order/1'));
  assert.match(response.headers.get('Content-Type'), /text\/html/);
  const body = await response.text();
  assert.match(body, /shopifycloud\/app-bridge\.js/);
  assert.doesNotMatch(body, /%PDF-|synthetic-primary|order-summary-/);
});

test.after(async () => { await db.$disconnect(); });
