// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createRequestHandler } from 'react-router';
import { createMerchantAgreement, merchantAgreement } from '../../merchant-agreement.js';
import { erasePrivacyShop } from '../../privacy.js';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Use the isolated Shopify test runner.');
const db = new PrismaClient();
const shop = 'synthetic-agreement.myshopify.com', other = 'synthetic-agreement-other.myshopify.com';
const handler = createRequestHandler(await import('../build/server/index.js'), 'production');
const service = createMerchantAgreement({ db });
const originalFetch = globalThis.fetch;
let remoteReads = 0;
globalThis.fetch = () => { remoteReads++; throw new Error('Agreement checks must not read orders or billing.'); };
const fields = () => ({ intent: 'accept', version: merchantAgreement.version, documentSha256: merchantAgreement.documentSha256, accepted: 'yes' });
const form = (values = fields()) => { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.append(key, value); return result; };
const context = (domain = shop, actor = '42') => ({ session: { shop: domain }, sessionToken: { sub: actor } });
const status = code => error => error instanceof Response && error.status === code;
function token(domain = shop, actor = '42', valid = true) {
  const at = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: `https://${domain}/admin`, dest: `https://${domain}`, aud: process.env.SHOPIFY_API_KEY, sub: actor, exp: at + 60, nbf: at - 1, iat: at, jti: randomUUID(), sid: randomUUID() })).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', valid ? process.env.SHOPIFY_API_SECRET : 'wrong-secret').update(`${head}.${body}`).digest('base64url')}`;
}
const request = (path, { domain = shop, actor = '42', valid = true, values } = {}) => handler(new Request(`https://fullbleed-test.invalid${path}`, {
  method: values ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token(domain, actor, valid)}`, ...(values ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
  ...(values ? { body: new URLSearchParams(values) } : {}),
}));

test.beforeEach(async () => {
  await db.agreementAcceptance.deleteMany(); await db.accessEvent.deleteMany(); await db.session.deleteMany();
  for (const domain of [shop, other]) await db.session.create({ data: { id: `offline_${domain}`, shop: domain, state: '', isOnline: false, accessToken: 'synthetic-token', userId: 999n, scope: 'read_orders' } });
  remoteReads = 0;
});
test.after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });

test('authenticated agreement and privacy tools remain usable before acceptance without order or billing reads', async () => {
  for (const path of ['/app/agreement', '/app/privacy', '/app/access']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    const text = await response.text();
    if (path === '/app/agreement') {
      assert.ok(text.includes(merchantAgreement.documentSha256));
      assert.match(text, /Accept and continue/); assert.ok(text.includes(merchantAgreement.documentUrl));
      assert.doesNotMatch(text, /synthetic-token/);
    }
  }
  assert.equal(remoteReads, 0); assert.equal(await db.agreementAcceptance.count(), 0);
});

test('every commerce route requires agreement before customer or billing access', async () => {
  for (const path of ['/app', '/app/pdf?order=gid://shopify/Order/1', '/app/template', '/app/templates', '/app/settings', '/app/automations', '/app/plans']) {
    const response = await request(path, path === '/app/template' ? { values: {} } : {});
    assert.equal(response.status, 302, path);
    assert.equal(new URL(response.headers.get('Location'), 'https://fullbleed-test.invalid').pathname, '/app/agreement');
  }
  assert.equal(remoteReads, 0);
});

test('signed Flow preparation is denied before agreement without reading the order or creating a job', async () => {
  const body = JSON.stringify({ shop_id: '1', shopify_domain: shop, action_run_id: randomUUID(), handle: 'create-order-summary-link', properties: { order_id: 'gid://shopify/Order/1' } });
  const before = await db.automationJob.count();
  const response = await handler(new Request('https://fullbleed-test.invalid/api/flow/documents', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(body).digest('base64'),
  }, body }));
  assert.equal(response.status, 428); assert.match(await response.text(), /accept the merchant agreement/);
  assert.equal(remoteReads, 0); assert.equal(await db.automationJob.count(), before);
});

test('real SDK acceptance uses the verified token subject and retains only bounded receipt fields', async () => {
  const response = await request('/app/agreement', { values: fields() });
  assert.equal(response.status, 302);
  const row = await db.agreementAcceptance.findUniqueOrThrow({ where: { shop } });
  assert.deepEqual(Object.keys(row).sort(), ['acceptedAt', 'actorId', 'documentSha256', 'shop', 'version']);
  assert.equal(row.actorId, '42', 'The offline session userId is not the acting staff identity.');
  assert.equal(row.documentSha256, merchantAgreement.documentSha256); assert.equal(row.version, merchantAgreement.version);
  assert.ok(row.acceptedAt <= new Date()); assert.equal((await service.status(shop)).accepted, true);
  assert.equal((await service.status(other)).accepted, false); assert.equal(remoteReads, 0);
  assert.doesNotMatch(JSON.stringify(row), /synthetic-token|address|email|orderId|ipAddress/);
});

test('missing confirmation, stale versions, wrong digests, extra fields and duplicate fields cannot record agreement', async () => {
  for (const values of [{ ...fields(), accepted: '' }, { ...fields(), version: 'old' }, { ...fields(), documentSha256: '0'.repeat(64) }, { ...fields(), shop: other }, { ...fields(), actorId: '99' }]) {
    const response = await request('/app/agreement', { values });
    assert.equal(response.status, 400); assert.equal(await db.agreementAcceptance.count(), 0);
  }
  const duplicated = form(); duplicated.append('accepted', 'yes');
  await assert.rejects(service.accept(context(), duplicated), status(400));
  assert.equal(remoteReads, 0);
});

test('invalid authentication or staff identity cannot create acceptance', async () => {
  const invalid = await request('/app/agreement', { values: fields(), valid: false });
  assert.ok(invalid.status >= 400);
  await assert.rejects(service.accept(context(shop, '0'), form()), status(401));
  assert.equal(await db.agreementAcceptance.count(), 0);
});

test('repeated acceptance is idempotent and cannot overwrite the first acting staff or time', async () => {
  await service.accept(context(), form());
  const before = await db.agreementAcceptance.findUniqueOrThrow({ where: { shop } });
  await service.accept(context(shop, '99'), form());
  assert.deepEqual(await db.agreementAcceptance.findUniqueOrThrow({ where: { shop } }), before);
});

test('a stored old agreement or changed document hash requires renewed acceptance', async () => {
  await service.accept(context(), form());
  for (const data of [{ version: 'old' }, { version: merchantAgreement.version, documentSha256: '0'.repeat(64) }]) {
    await db.agreementAcceptance.update({ where: { shop }, data });
    await assert.rejects(service.requireAccepted(shop), status(428));
    await service.accept(context(shop, '99'), form());
    await service.requireAccepted(shop);
    assert.equal((await db.agreementAcceptance.findUniqueOrThrow({ where: { shop } })).actorId, '99');
  }
});

test('uninstall or shop erasure removes agreement and a stale action cannot recreate it', async () => {
  await service.accept(context(), form()); await service.accept(context(other), form());
  await db.$transaction(tx => erasePrivacyShop(tx, shop));
  assert.equal(await db.agreementAcceptance.count({ where: { shop } }), 0);
  assert.equal(await db.agreementAcceptance.count({ where: { shop: other } }), 1);
  await assert.rejects(service.accept(context(), form()), status(401));
  assert.equal(await db.agreementAcceptance.count({ where: { shop } }), 0);
});

test('unavailable agreement storage cannot authorize work or expose raw database errors', async () => {
  const broken = createMerchantAgreement({ db: { agreementAcceptance: { findUnique: async () => { throw new Error('private-database-password'); } }, $transaction: async () => { throw new Error('private-database-password'); } } });
  for (const work of [() => broken.requireAccepted(shop), () => broken.accept(context(), form())]) {
    let rejected;
    await assert.rejects(work(), error => { rejected = error; return status(503)(error); });
    assert.doesNotMatch(await rejected.text(), /private-database-password/);
  }
});
