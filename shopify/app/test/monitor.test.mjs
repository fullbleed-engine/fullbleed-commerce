import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createRequestHandler } from 'react-router';
import { createPrivacyService, parsePrivacyPayload } from '../../privacy.js';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret' || process.env.FULLBLEED_PRIVACY_KEY !== 'ab'.repeat(32)) throw new Error('Use the isolated Shopify test runner.');
const db = new PrismaClient();
const handler = createRequestHandler(await import('../build/server/index.js'), 'production');
const token = 'cd'.repeat(32);
const shop = 'synthetic-monitor.myshopify.com';
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Operator monitoring must not call Shopify or billing.'); };
const request = (authorization = `Bearer ${token}`, query = '') => handler(new Request(`https://fullbleed-test.invalid/internal/monitor${query}`, { headers: authorization ? { Authorization: authorization } : {} }));
async function seed() {
  return createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY }).accept(parsePrivacyPayload(Buffer.from(JSON.stringify({
    shop_domain: shop, shop_id: 1, customer: { id: 9000, email: 'synthetic-monitor@example.invalid' }, data_request: { id: 7000 }, orders_requested: [],
  })), shop, 'CUSTOMERS_DATA_REQUEST'));
}
test.beforeEach(async () => {
  process.env.FULLBLEED_MONITOR_TOKEN = token;
  process.env.FULLBLEED_PRIVACY_KEY = 'ab'.repeat(32);
  await db.privacyRequest.deleteMany();
  await db.session.upsert({ where: { id: `offline_${shop}` }, update: {}, create: { id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-monitor-session' } });
});
test.after(async () => {
  globalThis.fetch = originalFetch;
  await db.privacyRequest.deleteMany(); await db.session.deleteMany({ where: { shop } });
  await db.$disconnect();
});

test('operator monitoring is unavailable until a separate valid token is configured', async () => {
  for (const value of ['', 'short']) {
    process.env.FULLBLEED_MONITOR_TOKEN = value;
    const response = await request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable' });
  }
});

test('missing, malformed and incorrect authorization cannot read aggregates or use URL credentials', async () => {
  await seed();
  for (const authorization of ['', 'Bearer short', `Bearer ${'ef'.repeat(32)}`, `Basic ${token}`]) {
    const response = await request(authorization, `?token=${token}`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { status: 'unauthorized' });
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
});

test('valid monitor credentials return only private aggregate counters without paid access', async () => {
  await seed();
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Cache-Control'), /no-store, private/);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['checkedAt', 'privacy', 'status']);
  assert.deepEqual(body.privacy, { pending: 1, overdue: 0, dueWithin48Hours: 0, keyMismatch: 0 });
  assert.doesNotMatch(JSON.stringify(body), /synthetic|9000|7000|snapshot|customer|order|export|accessToken/);
});

test('approaching and overdue deadlines return an actionable failure without clearing the request', async () => {
  const id = await seed();
  for (const hours of [24, -1]) {
    await db.privacyRequest.update({ where: { id }, data: { dueAt: new Date(Date.now() + hours * 3600000) } });
    const response = await request();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.status, 'attention'); assert.equal(body.privacy.dueWithin48Hours, 1);
    assert.equal(body.privacy.overdue, hours < 0 ? 1 : 0);
    assert.equal((await db.privacyRequest.findUniqueOrThrow({ where: { id } })).status, 'ready');
  }
});

test('wrong or absent privacy keys fail monitoring without leaking the encrypted export', async () => {
  await seed();
  process.env.FULLBLEED_PRIVACY_KEY = 'ef'.repeat(32);
  let response = await request();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).privacy.keyMismatch, 1);
  process.env.FULLBLEED_PRIVACY_KEY = '';
  response = await request();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'unavailable' });
});
