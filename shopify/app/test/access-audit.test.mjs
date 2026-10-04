// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createRequestHandler } from 'react-router';
import { createAccessAudit, staffActor, pruneAccessEvents } from '../../access-audit.js';
import { createPrivacyService, erasePrivacyShop, completePrivacyRequest, applyRecoveryEvent } from '../../privacy.js';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Use the isolated Shopify test runner.');
const db = new PrismaClient();
const handler = createRequestHandler(await import('../build/server/index.js'), 'production');
const shop = 'synthetic-audit.myshopify.com', other = 'synthetic-audit-other.myshopify.com';
const orderId = 'gid://shopify/Order/820982911946154508';
let at;
const now = () => new Date(at);
const audit = createAccessAudit({ db, now });
const input = (extra = {}) => ({ shop, actor: staffActor({ sub: '42' }), operation: 'document.render', orderId, ...extra });
const status = code => error => error instanceof Response && error.status === code;
const privacy = () => createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY, now });
const request = (extra = {}) => ({ shop, customerId: '77', email: 'synthetic@example.invalid', requestId: '90001', orderIds: [orderId], ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Audit and privacy history must not call billing or an external store.'); };

function token(domain = shop, subject = '42', valid = true) {
  const time = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: `https://${domain}/admin`, dest: `https://${domain}`, aud: process.env.SHOPIFY_API_KEY, sub: subject, exp: time + 60, nbf: time - 1, iat: time, jti: randomUUID(), sid: randomUUID() })).toString('base64url');
  return `${header}.${claims}.${createHmac('sha256', valid ? process.env.SHOPIFY_API_SECRET : 'wrong-secret').update(`${header}.${claims}`).digest('base64url')}`;
}
const admin = (path, domain = shop, subject = '42', valid = true) => handler(new Request(`https://fullbleed-test.invalid${path}`, { headers: { Authorization: `Bearer ${token(domain, subject, valid)}` } }));

test.beforeEach(async () => {
  await db.accessEvent.deleteMany(); await db.privacyRequest.deleteMany(); await db.automationSettings.deleteMany(); await db.usagePeriod.deleteMany(); await db.session.deleteMany();
  at = Date.now();
  for (const domain of [shop, other]) await db.session.create({ data: { id: `offline_${domain}`, shop: domain, state: '', isOnline: false, accessToken: 'synthetic-token', userId: 999n } });
});
test.after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });

test('a durable started entry precedes work; completion keeps only bounded metadata', async () => {
  const result = await audit.run({ ...input(), address: 'secret-address', token: 'secret-token', document: '%PDF-secret' }, async ticket => {
    const row = await db.accessEvent.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(row.outcome, 'started'); assert.equal(row.finishedAt, null); assert.equal(row.actorId, '42');
    return new Response('synthetic customer data', { status: 200 });
  });
  assert.equal(await result.text(), 'synthetic customer data');
  const row = await db.accessEvent.findFirstOrThrow();
  assert.equal(row.outcome, 'completed'); assert.equal(row.orderId, orderId);
  assert.doesNotMatch(JSON.stringify(row), /secret-address|secret-token|%PDF-|synthetic customer data|accessToken/);
});

test('only verified-shaped staff identities and fixed operation/actor types are accepted', async () => {
  for (const subject of [null, {}, { sub: '' }, { sub: 'alice@example.invalid' }, { sub: 42 }, { sub: '0' }]) assert.throws(() => staffActor(subject), status(401));
  for (const changed of [{ operation: 'toString' }, { actor: { type: 'flow', id: '42' } }, { actor: { type: 'staff', id: '42\nsecret' } }, { orderId: 'https://example.invalid' }, { requestId: 'secret' }]) {
    await assert.rejects(audit.run(input(changed), async () => assert.fail('Invalid metadata reached data access')), status(503));
  }
  assert.equal(await db.accessEvent.count(), 0);
});

test('a missing installation or failed audit write prevents the protected work', async () => {
  await db.session.deleteMany({ where: { shop } });
  await assert.rejects(audit.run(input(), async () => assert.fail('Uninstalled access')), status(401));
  const broken = createAccessAudit({ db: { $transaction: async () => { throw new Error('database-password-secret'); } } });
  await assert.rejects(broken.run(input(), async () => assert.fail('Unaudited access')), asyncError => asyncError instanceof Response && asyncError.status === 503);
  assert.equal(await db.accessEvent.count(), 0);
});

test('denied and failed work are recorded without raw error details', async () => {
  const denied = await audit.run(input(), async () => new Response('not allowed', { status: 403 }));
  assert.equal(denied.status, 403);
  await assert.rejects(audit.run(input(), async () => { throw new Error('secret-customer-address'); }), /secret-customer-address/);
  const rows = await db.accessEvent.findMany({ orderBy: { startedAt: 'asc' } });
  assert.deepEqual(new Set(rows.map(row => row.outcome)), new Set(['denied', 'failed']));
  assert.doesNotMatch(JSON.stringify(rows), /secret-customer-address|not allowed/);
});

test('completion persistence failure withholds data and leaves an honest started entry', async () => {
  let calls = 0, read = false;
  const broken = createAccessAudit({ db: { $transaction: work => ++calls === 1 ? db.$transaction(work) : Promise.reject(new Error('private-db-location')) } });
  await assert.rejects(broken.run(input(), async () => { read = true; return 'private response'; }), status(503));
  assert.equal(read, true);
  assert.equal((await db.accessEvent.findFirstOrThrow()).outcome, 'started');
});

test('real Shopify JWT authentication attributes staff access, isolates stores and ignores offline user ID', async () => {
  await audit.run(input({ shop: other, actor: { type: 'staff', id: '777' } }), async () => 'other-store');
  const forged = await admin('/app/access', shop, '42', false);
  assert.notEqual(forged.status, 200); assert.equal(await db.accessEvent.count({ where: { shop } }), 0);
  const response = await admin('/app/access');
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  const html = await response.text();
  assert.match(html, /Access history/); assert.doesNotMatch(html, /777|synthetic-audit-other|synthetic-token/);
  const row = await db.accessEvent.findFirstOrThrow({ where: { shop } });
  assert.equal(row.actorType, 'staff'); assert.equal(row.actorId, '42'); assert.equal(row.operation, 'access.list'); assert.equal(row.outcome, 'completed');
});

test('history is bounded, store scoped and cursor validated; expired rows are hidden before cleanup', async () => {
  const foreign = await db.accessEvent.create({ data: { shop: other, actorType: 'staff', actorId: '8', operation: 'orders.list' } });
  await assert.rejects(audit.list(shop, foreign.id), status(400));
  await assert.rejects(audit.list(shop, '../outside'), status(400));
  for (let i = 0; i < 55; i++) await db.accessEvent.create({ data: { shop, actorType: 'staff', actorId: '42', operation: 'orders.list', startedAt: new Date(at - i * 1000) } });
  await db.accessEvent.create({ data: { shop, actorType: 'staff', actorId: '42', operation: 'orders.list', startedAt: new Date(at - 31 * 86400000) } });
  const first = await audit.list(shop), second = await audit.list(shop, first.next);
  assert.equal(first.events.length, 50); assert.equal(second.events.length, 5); assert.equal(second.next, null);
  assert.equal(new Set([...first.events, ...second.events].map(row => row.id)).size, 55);
  assert.equal((await pruneAccessEvents(db, now())).count, 1);
  assert.equal(await db.accessEvent.count({ where: { shop: other } }), 1);
});

test('customer exports include only requested order access, omit staff IDs and erase the same records', async () => {
  await audit.run(input(), async () => 'one');
  await audit.run(input({ orderId: 'gid://shopify/Order/2' }), async () => 'two');
  await audit.run(input({ shop: other }), async () => 'other');
  const id = await privacy().accept(request());
  const exported = await privacy().exportData(shop, id);
  assert.equal(exported.orderAccess.length, 1); assert.equal(exported.orderAccess[0].orderId, orderId);
  assert.equal(exported.orderAccess[0].actorType, 'staff'); assert.equal(exported.orderAccess[0].actorId, undefined);
  await privacy().redact(request());
  assert.equal(await db.accessEvent.count({ where: { shop, orderId } }), 0);
  assert.equal(await db.accessEvent.count({ where: { shop, orderId: 'gid://shopify/Order/2' } }), 1);
  assert.equal(await db.accessEvent.count({ where: { shop: other } }), 1);
});

test('privacy-export access is attributable, has no billing call, and completion removes its reference', async () => {
  const id = await privacy().accept(request());
  const response = await admin(`/app/privacy-export?id=${id}`, shop, '81');
  assert.equal(response.status, 200); assert.equal((await response.json()).requestId, '90001');
  const row = await db.accessEvent.findFirstOrThrow({ where: { requestId: id } });
  assert.equal(row.actorId, '81'); assert.equal(row.operation, 'privacy.export'); assert.equal(row.outcome, 'completed');
  assert.equal((await admin(`/app/privacy-export?id=${id}`, other)).status, 404);
  assert.equal(await db.accessEvent.count({ where: { shop: other } }), 0);
  await completePrivacyRequest(db, shop, id, now());
  assert.equal(await db.accessEvent.count({ where: { requestId: id } }), 0);
});

test('customer erasure racing an order read withholds the response and cannot recreate the audit entry', async () => {
  const started = deferred(), release = deferred();
  const work = audit.run(input(), async () => { started.resolve(); await release.promise; return 'private result'; });
  const rejected = assert.rejects(work, status(410));
  await started.promise;
  await privacy().redact(request());
  release.resolve(); await rejected;
  assert.equal(await db.accessEvent.count({ where: { shop } }), 0);
});

test('uninstall racing collection access withholds data and keeps another store intact', async () => {
  await audit.run(input({ shop: other }), async () => 'other');
  const started = deferred(), release = deferred();
  const work = audit.run(input({ operation: 'orders.list', orderId: undefined }), async () => { started.resolve(); await release.promise; return ['private order']; });
  const rejected = assert.rejects(work, status(410));
  await started.promise;
  await db.$transaction(tx => erasePrivacyShop(tx, shop));
  release.resolve(); await rejected;
  assert.equal(await db.accessEvent.count({ where: { shop } }), 0);
  assert.equal(await db.accessEvent.count({ where: { shop: other } }), 1);
});

test('replayed customer and shop erasure also remove access records restored from backup', async () => {
  await audit.run(input(), async () => 'one');
  await audit.run(input({ shop: other }), async () => 'other');
  await db.$transaction(tx => applyRecoveryEvent(tx, { type: 'erase-customer', shop, customerKey: null, emailKey: null, orderIds: [orderId] }, now()));
  assert.equal(await db.accessEvent.count({ where: { shop } }), 0);
  await db.$transaction(tx => applyRecoveryEvent(tx, { type: 'erase-shop', shop: other }, now()));
  assert.equal(await db.accessEvent.count(), 0);
});
