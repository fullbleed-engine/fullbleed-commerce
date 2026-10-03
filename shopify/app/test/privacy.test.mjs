// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createRequestHandler } from 'react-router';
import { createPrivacyService, completePrivacyRequest, parsePrivacyPayload, prunePrivacyRequests } from '../../privacy.js';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret' || process.env.FULLBLEED_PRIVACY_KEY !== 'ab'.repeat(32)) throw new Error('Use the isolated Shopify test runner.');
const db = new PrismaClient();
const handler = createRequestHandler(await import('../build/server/index.js'), 'production');
const primary = 'synthetic-primary.myshopify.com';
const other = 'synthetic-other.myshopify.com';
const large = '820982911946154508';
const orderId = `gid://shopify/Order/${large}`;
const secret = process.env.SHOPIFY_API_SECRET;
let at;
const service = createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY, now: () => new Date(at) });
const payload = (shop = primary, requestId = '9999', overrides = {}) => ({ shop_domain: shop, shop_id: '1', customer: { id: '191167', email: 'synthetic@example.invalid', phone: 'ignored-phone' }, data_request: { id: requestId }, orders_requested: [large], ...overrides });
const input = data => parsePrivacyPayload(Buffer.from(JSON.stringify(data)), data.shop_domain, 'CUSTOMERS_DATA_REQUEST');
async function hook(topic, data, { valid = true, shop = data.shop_domain, raw = JSON.stringify(data) } = {}) {
  return handler(new Request(`https://fullbleed-test.invalid${topic === 'app/uninstalled' ? '/webhooks/app/uninstalled' : '/webhooks/privacy'}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Shopify-Topic': topic, 'X-Shopify-Shop-Domain': shop,
    'X-Shopify-API-Version': '2026-10', 'X-Shopify-Webhook-Id': randomUUID(),
    'X-Shopify-Hmac-Sha256': valid ? createHmac('sha256', secret).update(raw).digest('base64') : 'invalid',
  }, body: raw }));
}
function adminToken(shop) {
  const time = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: process.env.SHOPIFY_API_KEY, sub: '1', exp: time + 60, nbf: time - 1, iat: time, jti: randomUUID(), sid: randomUUID() })).toString('base64url');
  return `${header}.${body}.${createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')}`;
}
async function admin(path, shop = primary, form = null) {
  return handler(new Request(`https://fullbleed-test.invalid${path}`, { method: form ? 'POST' : 'GET', headers: { Authorization: `Bearer ${adminToken(shop)}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(form ? { body: new URLSearchParams(form) } : {}) }));
}
const redaction = (overrides = {}) => ({ shop_domain: primary, shop_id: '1', customer: { email: 'synthetic@example.invalid' }, orders_to_redact: [], ...overrides });
const expectStatus = status => error => error instanceof Response && error.status === status;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Privacy requests must not fetch new customer data or paid-plan status.'); };

test.beforeEach(async () => {
  await db.privacyRequest.deleteMany(); await db.automationSettings.deleteMany(); await db.session.deleteMany();
  at = Date.now();
  for (const shop of [primary, other]) {
    await db.session.create({ data: { id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-token', scope: 'read_orders' } });
    await db.automationSettings.create({ data: { shop } });
    await db.automationJob.create({ data: { shop, runId: 'synthetic-run', handle: 'create-order-summary-link', orderId, kind: 'order-summary', requestHash: 'synthetic-hash', ttlHours: 24, retryDeadline: new Date(at + 3600000), status: 'ready', downloads: 2, pdfSha256: 'synthetic-pdf-hash', fingerprint: 'synthetic-fingerprint', lastError: 'temporarily_unavailable', expiresAt: new Date(at + 3600000) } });
  }
});
test.after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });

test('privacy erasure and completion cannot acknowledge success without durable recovery storage', async () => {
  const id = await service.accept(input(payload()));
  await service.exportData(primary, id);
  const directory = process.env.FULLBLEED_RECOVERY_DIRECTORY;
  assert.match(directory, /webhook-recovery-/);
  const marker = join(directory, 'dataset.bin'), held = join(directory, '.synthetic-marker-held');
  await rename(marker, held);
  try {
    for (const topic of ['customers/redact', 'shop/redact', 'app/uninstalled']) {
      const response = await hook(topic, topic === 'customers/redact' ? redaction() : { shop_domain: primary, shop_id: 1 });
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /webhook-recovery-|secretAccessKey|synthetic-token/);
    }
    assert.equal((await admin('/app/privacy', primary, { intent: 'complete', id, confirmed: 'yes' })).status, 503);
    assert.equal((await db.privacyRequest.findUniqueOrThrow({ where: { id } })).status, 'ready');
    assert.equal(await db.session.count({ where: { shop: primary } }), 1);
    assert.equal((await db.automationJob.findFirst({ where: { shop: primary } })).status, 'ready');
  } finally { await rename(held, marker); }
  assert.equal((await hook('customers/redact', redaction())).status, 204);
});

test('signed raw webhook preserves large numeric IDs, snapshots once, and excludes credentials', async () => {
  const data = payload();
  const raw = JSON.stringify(data).replace(`"${large}"`, large).replace('"191167"', '191167').replace('"9999"', '9999');
  assert.equal((await hook('customers/data_request', data, { raw })).status, 204);
  const row = await db.privacyRequest.findFirst({ where: { shop: primary } });
  assert.doesNotMatch(row.snapshot, /synthetic@example|synthetic-run|820982|ignored-phone/);
  const report = await service.exportData(primary, row.id);
  assert.equal(report.requestedOrderIds[0], orderId);
  assert.equal(report.automationJobs.length, 1);
  assert.equal(report.automationJobs[0].downloads, 2);
  assert.equal(report.customer.id, '191167');
  assert.doesNotMatch(JSON.stringify(report), /accessToken|refreshToken|leaseId|downloadUrl|ignored-phone|synthetic-token/);
  await db.automationJob.deleteMany({ where: { shop: primary } });
  assert.equal((await hook('customers/data_request', payload(primary, '9999', { orders_requested: ['42'] }))).status, 204);
  assert.equal(await db.privacyRequest.count(), 1);
  assert.deepEqual(await service.exportData(primary, row.id), report);
});

test('forged signatures and changed shop headers cannot create or erase another store', async () => {
  assert.equal((await hook('customers/data_request', payload(), { valid: false })).status, 401);
  assert.equal((await hook('customers/data_request', payload(), { shop: other })).status, 403);
  assert.equal(await db.privacyRequest.count(), 0);
  assert.equal((await hook('shop/redact', { shop_domain: primary, shop_id: 1 }, { shop: other })).status, 403);
  assert.equal(await db.session.count(), 2);
});

test('authenticated export is store-scoped and works without paid-plan checks', async () => {
  const id = await service.accept(input(payload()));
  const response = await admin(`/app/privacy-export?id=${id}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /private.*max-age=0/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Disposition'), /fullbleed-privacy-9999.json/);
  assert.equal((await response.json()).shop, primary);
  assert.equal((await admin(`/app/privacy-export?id=${id}`, other)).status, 404);
  const anonymous = await handler(new Request(`https://fullbleed-test.invalid/app/privacy-export?id=${id}`));
  assert.doesNotMatch(anonymous.headers.get('Content-Type') || '', /application\/json/);
  assert.doesNotMatch(await anonymous.text(), /synthetic@example|synthetic-run/);
});

test('email-only erasure clears captured exports, revokes jobs, preserves tenant isolation and rejects replay', async () => {
  const id = await service.accept(input(payload(primary, '9999', { customer: { email: 'Synthetic@Example.Invalid' } })));
  const otherId = await service.accept(input(payload(other)));
  assert.equal((await hook('customers/redact', redaction())).status, 204);
  const row = await db.privacyRequest.findUnique({ where: { id } });
  assert.equal(row.status, 'redacted');
  for (const field of ['snapshot', 'emailKey', 'customerKey', 'lastExportAt']) assert.equal(row[field], null);
  assert.equal(await db.privacyRequestOrder.count({ where: { requestId: id } }), 0);
  const job = await db.automationJob.findFirst({ where: { shop: primary } });
  assert.equal(job.orderId, ''); assert.equal(job.status, 'revoked'); assert.equal(job.downloads, 0); assert.equal(job.lastError, null);
  assert.equal((await db.automationJob.findFirst({ where: { shop: other } })).status, 'ready');
  await assert.rejects(service.exportData(primary, id), expectStatus(410));
  assert.equal((await service.exportData(other, otherId)).automationJobs.length, 1);
  assert.equal(await service.accept(input(payload())), id);
  assert.equal((await db.privacyRequest.findUnique({ where: { id } })).snapshot, null);
  assert.equal((await hook('customers/redact', redaction())).status, 204);
});

test('order references match erasure when customer identifiers changed', async () => {
  const id = await service.accept(input(payload()));
  assert.equal((await hook('customers/redact', redaction({ customer: { id: '2', email: 'changed@example.invalid' }, orders_to_redact: [large] }))).status, 204);
  await assert.rejects(service.exportData(primary, id), expectStatus(410));
});

test('merchant completion requires an export and explicit confirmation, then erases the snapshot', async () => {
  const id = await service.accept(input(payload()));
  await assert.rejects(completePrivacyRequest(db, primary, id), expectStatus(409));
  await service.exportData(primary, id);
  assert.equal((await admin('/app/privacy', primary, { intent: 'complete', id })).status, 400);
  assert.equal((await admin('/app/privacy', other, { intent: 'complete', id, confirmed: 'yes' })).status, 404);
  assert.equal((await admin('/app/privacy', primary, { intent: 'complete', id, confirmed: 'yes' })).status, 200);
  const row = await db.privacyRequest.findUnique({ where: { id } });
  assert.equal(row.status, 'completed'); assert.equal(row.snapshot, null); assert.equal(row.emailKey, null);
  assert.equal(await db.privacyRequestOrder.count(), 0);
  await completePrivacyRequest(db, primary, id);
  await assert.rejects(service.exportData(primary, id), expectStatus(410));
});

test('shop erasure deletes exports and delayed data requests cannot recreate them without installation', async () => {
  await service.accept(input(payload())); await service.accept(input(payload(other)));
  assert.equal((await hook('shop/redact', { shop_domain: primary, shop_id: 1 })).status, 204);
  assert.equal(await db.privacyRequest.count({ where: { shop: primary } }), 0);
  assert.equal(await db.privacyRequest.count({ where: { shop: other } }), 1);
  assert.equal((await hook('customers/data_request', payload())).status, 503);
  assert.equal(await db.privacyRequestOrder.count(), 1);
});

test('retention prunes terminal receipts after 30 days and retains overdue outstanding requests', async () => {
  const id = await service.accept(input(payload()));
  await service.exportData(primary, id); await completePrivacyRequest(db, primary, id, new Date(at));
  const outstanding = await service.accept(input(payload(primary, '10000')));
  await prunePrivacyRequests(db, new Date(at + 31 * 24 * 3600000));
  assert.equal(await db.privacyRequest.count(), 1);
  assert.equal((await service.exportData(primary, outstanding)).requestId, '10000');
});

test('wrong keys and swapped ciphertext fail closed without recording successful exports', async () => {
  const id = await service.accept(input(payload()));
  const second = await service.accept(input(payload(other)));
  const row = await db.privacyRequest.findUnique({ where: { id } });
  await db.privacyRequest.update({ where: { id: second }, data: { snapshot: row.snapshot } });
  await assert.rejects(service.exportData(other, second), expectStatus(503));
  await assert.rejects(createPrivacyService({ db, key: 'cd'.repeat(32) }).exportData(primary, id), expectStatus(503));
  const wrongKey = createPrivacyService({ db, key: 'cd'.repeat(32) });
  await assert.rejects(wrongKey.redact(parsePrivacyPayload(Buffer.from(JSON.stringify(redaction())), primary, 'CUSTOMERS_REDACT')), expectStatus(503));
  await assert.rejects(wrongKey.accept(input(payload(primary, '10001'))), expectStatus(503));
  assert.equal((await db.privacyRequest.findUnique({ where: { id } })).exports, 0);
  assert.throws(() => createPrivacyService({ db, key: '' }), expectStatus(503));
});

test('payload limits and invalid ID spellings do not silently truncate requests', async () => {
  for (const value of ['0', '-1', '1.5', '1e3', '001', '123456789012345678901']) assert.throws(() => input(payload(primary, '9999', { orders_requested: [value] })), expectStatus(400));
  assert.equal((await hook('customers/data_request', payload(), { raw: JSON.stringify(payload()).replace(`"${large}"`, '1e3') })).status, 400);
  assert.equal((await hook('customers/data_request', payload(primary, '9999', { orders_requested: Array(10001).fill('1') }))).status, 400);
  assert.equal((await hook('customers/data_request', payload(), { raw: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal(await db.privacyRequest.count(), 0);
});

test('merchant page shows deadlines without exposing customer identifiers in list HTML', async () => {
  await service.accept(input(payload()));
  const page = await admin('/app/privacy');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Cache-Control'), /no-store/);
  const html = await page.text();
  assert.match(html, /Privacy requests/); assert.match(html, /9999/); assert.match(html, /Respond by/);
  assert.doesNotMatch(html, /synthetic@example|820982911946154508|synthetic-fingerprint/);
});

test('batched order references capture and redact beyond one SQL parameter chunk', async () => {
  const orders = Array.from({ length: 501 }, (_, i) => String(i + 1));
  const id = await service.accept(input(payload(primary, '10001', { orders_requested: orders })));
  assert.equal(await db.privacyRequestOrder.count({ where: { requestId: id } }), 501);
  assert.equal((await service.exportData(primary, id)).requestedOrderIds.length, 501);
  assert.equal((await hook('customers/redact', redaction({ customer: { id: '2' }, orders_to_redact: ['501'] }))).status, 204);
  assert.equal(await db.privacyRequestOrder.count(), 0);
  await assert.rejects(service.exportData(primary, id), expectStatus(410));
});

test('pagination reaches older requests without accepting another store cursor', async () => {
  const ids = [];
  for (let index = 0; index < 51; index++) {
    at += 1000;
    ids.push(await service.accept(input(payload(primary, String(20000 + index), { orders_requested: [] }))));
  }
  const foreign = await service.accept(input(payload(other)));
  const first = (await (await admin('/app/privacy')).text()).replaceAll(/<!--[\s\S]*?-->/g, '');
  assert.match(first, /Prepare export 20000/); assert.doesNotMatch(first, /Prepare export 20050/);
  const second = (await (await admin(`/app/privacy?after=${ids[49]}`)).text()).replaceAll(/<!--[\s\S]*?-->/g, '');
  assert.match(second, /Prepare export 20050/); assert.doesNotMatch(second, /Prepare export 20000/);
  assert.equal((await admin(`/app/privacy?after=${foreign}`)).status, 400);
});

test('uninstall removes privacy exports and associations for only that store', async () => {
  await service.accept(input(payload())); await service.accept(input(payload(other)));
  assert.equal((await hook('app/uninstalled', { shop_domain: primary })).status, 204);
  assert.equal(await db.privacyRequest.count({ where: { shop: primary } }), 0);
  assert.equal(await db.privacyRequest.count({ where: { shop: other } }), 1);
  assert.equal(await db.privacyRequestOrder.count(), 1);
});

test('operator monitoring reports deadlines and key failures without customer data', async () => {
  await service.accept(input(payload()));
  at += 31 * 24 * 3600000;
  const result = await service.status();
  assert.equal(result.pending, 1); assert.equal(result.overdue, 1); assert.equal(result.dueWithin48Hours, 1); assert.equal(result.keyMismatch, 0);
  assert.doesNotMatch(JSON.stringify(result), /synthetic|191167|9999/);
  assert.equal((await createPrivacyService({ db, key: 'cd'.repeat(32) }).status()).keyMismatch, 1);
});
