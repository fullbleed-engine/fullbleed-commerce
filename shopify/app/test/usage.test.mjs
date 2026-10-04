// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createUsageMeter, usageAllowance, isUsageLimit, pruneUsage } from '../../usage.js';
import { createPrivacyService, erasePrivacyShop, applyRecoveryEvent } from '../../privacy.js';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Use the isolated Shopify test runner.');
const db = new PrismaClient(), competingDb = new PrismaClient();
const shop = 'synthetic-usage.myshopify.com', other = 'synthetic-usage-other.myshopify.com';
const order = id => `gid://shopify/Order/${id}`;
let at;
const now = () => new Date(at);
const meter = createUsageMeter({ db, now }), competing = createUsageMeter({ db: competingDb, now });
const subscription = (handle = 'studio') => ({ handle, billingPeriod: 'EVERY_30_DAYS', currentBillingCycle: { startTime: '2026-10-01T00:00:00Z', endTime: '2026-10-31T00:00:00Z' } });
const allowance = (limit = 2) => ({ ...usageAllowance(subscription(), now()), orders: limit });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test.beforeEach(async () => {
  at = Date.parse('2026-10-04T00:00:00Z');
  await db.usagePeriod.deleteMany(); await db.session.deleteMany(); await db.privacyRequest.deleteMany();
  for (const domain of [shop, other]) await db.session.create({ data: { id: `offline_${domain}`, shop: domain, state: '', accessToken: 'synthetic-token', isOnline: false } });
});
test.after(async () => { await db.$disconnect(); await competingDb.$disconnect(); });

test('active plans and valid Shopify cycles determine allowance; pending changes cannot grant it', () => {
  const active = { ...subscription(), pendingHandles: ['scale'] };
  assert.equal(usageAllowance(active, now()).orders, 250);
  assert.equal(usageAllowance(subscription('scale'), now()).orders, 1000);
  for (const changed of [{ handle: 'toString' }, { handle: 'unknown' }, { billingPeriod: 'ANNUAL' }, { currentBillingCycle: null }, { currentBillingCycle: { startTime: 'bad', endTime: 'bad' } }]) assert.throws(() => usageAllowance({ ...active, ...changed }, now()), e => e.status === 503);
  const trial = usageAllowance({ ...active, currentBillingCycle: null, trialEndsAt: '2026-10-10T00:00:00Z' }, now());
  assert.equal(trial.trial, true); assert.match(trial.key, /^trial:/);
  assert.throws(() => usageAllowance(active, new Date('2026-10-31T00:00:00Z')), e => e.status === 503);
});

test('summaries, packing slips, previews and reprints share one durable order unit', async () => {
  for (const output of ['summary', 'packing-slip', 'preview', 'reprint']) assert.equal(await meter.run(shop, order(1), allowance(), async () => output), output);
  assert.deepEqual(await competing.status(shop, allowance()), { used: 1, preparing: 0, remaining: 1, limit: 2 });
  await competing.run(shop, order(2), allowance(), async () => 'another worker');
  await assert.rejects(meter.run(shop, order(3), allowance(), async () => assert.fail('No work beyond allowance')), isUsageLimit);
  assert.equal(await meter.run(shop, order(1), allowance(), async () => 'at limit'), 'at limit');
  assert.equal((await meter.status(other, allowance())).used, 0);
  assert.equal(await db.usageOrder.count(), 2);
});

test('competing clients cannot spend the same final slot or the same order twice', async () => {
  const started = deferred(), finish = deferred();
  const first = meter.run(shop, order(1), allowance(1), async () => { started.resolve(); await finish.promise; return 'first'; });
  await started.promise;
  assert.deepEqual(await competing.status(shop, allowance(1)), { used: 0, preparing: 1, remaining: 0, limit: 1 });
  await assert.rejects(competing.run(shop, order(1), allowance(1), async () => assert.fail()), e => e.status === 429);
  await assert.rejects(competing.run(shop, order(2), allowance(1), async () => assert.fail()), isUsageLimit);
  finish.resolve(); await first;
  // Actually race two SQLite writers for the last slot in a fresh store.
  const results = await Promise.allSettled([meter.run(other, order(1), allowance(1), async () => 'a'), competing.run(other, order(2), allowance(1), async () => 'b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(isUsageLimit(results.find(r => r.status === 'rejected').reason));
  assert.equal((await meter.status(other, allowance(1))).used, 1);
});

test('upgrades and downgrades keep cycle usage; a new billing cycle gets its own allowance', async () => {
  await meter.run(shop, order(1), allowance(1), async () => 'ok');
  await meter.run(shop, order(2), { ...allowance(2), handle: 'scale' }, async () => 'upgraded');
  assert.equal((await meter.status(shop, allowance(1))).remaining, 0);
  assert.equal(await meter.run(shop, order(2), allowance(1), async () => 'downgrade reprint'), 'downgrade reprint');
  const next = { ...allowance(1), key: 'cycle:2026-10-31T00:00:00.000Z', startsAt: new Date('2026-10-31'), endsAt: new Date('2026-11-30') };
  at = Date.parse('2026-11-01');
  assert.equal((await meter.status(shop, next)).used, 0);
  await meter.run(shop, order(1), next, async () => 'new cycle');
  assert.equal((await meter.status(shop, next)).used, 1);
});

test('failed rendering and expired worker reservations free capacity without charging work', async () => {
  await assert.rejects(meter.run(shop, order(1), allowance(1), async () => { throw new Error('Renderer failed'); }), /Renderer failed/);
  await assert.rejects(meter.run(shop, order(2), allowance(1), async () => new Response('Changed document', { status: 410 })), e => e.status === 410);
  assert.equal(await db.usageOrder.count(), 0);
  const started = deferred(), finish = deferred();
  const stale = meter.run(shop, order(1), allowance(1), async () => { started.resolve(); await finish.promise; return 'expired worker'; });
  await started.promise; at += 91000;
  await competing.run(shop, order(2), allowance(1), async () => 'replacement');
  finish.resolve(); await assert.rejects(stale, e => e.status === 409);
  assert.deepEqual(await meter.status(shop, allowance(1)), { used: 1, preparing: 0, remaining: 0, limit: 1 });
});

test('Shopify trial timestamp changes preserve usage on upgrade and downgrade, including at the limit', async () => {
  const trial = (handle, end) => ({ ...usageAllowance({ ...subscription(handle), currentBillingCycle: null, trialEndsAt: end }, now()), orders: handle === 'scale' ? 2 : 1 });
  const original = trial('studio', '2026-10-11T02:48:23Z');
  await meter.run(shop, order(1), original, async () => 'first trial document');
  const upgrade = trial('scale', '2026-10-11T02:52:31Z');
  assert.deepEqual(await meter.status(shop, upgrade), { used: 1, preparing: 0, remaining: 1, limit: 2 });
  await meter.run(shop, order(1), upgrade, async () => 'same order after upgrade');
  await meter.run(shop, order(2), upgrade, async () => 'second order');
  const downgrade = trial('studio', '2026-10-12T02:52:31Z');
  await assert.rejects(meter.run(shop, order(3), downgrade, async () => assert.fail()), isUsageLimit);
  assert.equal(await db.usagePeriod.count(), 1);
  const period = await db.usagePeriod.findFirst();
  assert.equal(period.used, 2); assert.equal(period.endsAt.toISOString(), downgrade.endsAt.toISOString());
  at = Date.parse('2026-10-11T03:00:00Z');
  assert.deepEqual(await meter.status(shop, downgrade), { used: 2, preparing: 0, remaining: 0, limit: 1 });
  assert.equal(await meter.run(shop, order(1), downgrade, async () => 'reprint'), 'reprint');
  // A first actual paid cycle has a separate allowance, even while trial
  // receipts remain within their support retention window.
  const paid = { ...allowance(), key: 'cycle:2026-10-11T03:00:00.000Z', startsAt: now() };
  assert.equal((await meter.status(shop, paid)).used, 0);
});

test('privacy exports include usage; redaction clears order references and blocks in-flight completion', async () => {
  await meter.run(shop, order(1), allowance(), async () => 'ok');
  const service = createPrivacyService({ db, key: 'ab'.repeat(32), now });
  const input = { shop, customerId: '99', email: null, orderIds: [order(1), order(2)], requestId: '101' };
  const request = await service.accept(input);
  const exported = await service.exportData(shop, request);
  assert.equal(exported.orderUsage[0].orderId, order(1));
  assert.doesNotMatch(JSON.stringify(exported), /reservedUntil|synthetic-token/);
  const started = deferred(), finish = deferred();
  const pending = meter.run(shop, order(2), allowance(), async () => { started.resolve(); await finish.promise; return 'late'; });
  await started.promise; await service.redact(input); finish.resolve();
  await assert.rejects(pending, e => e.status === 409);
  assert.equal(await db.usageOrder.count(), 0);
  assert.equal((await meter.status(shop, allowance())).used, 1, 'Anonymous past usage remains counted.');
  assert.equal((await db.privacyRequest.findUniqueOrThrow({ where: { id: request } })).snapshot, null);
});

test('uninstall, reinstall and recovery erasure cannot resurrect an in-flight usage receipt', async () => {
  const started = deferred(), finish = deferred();
  const pending = meter.run(shop, order(1), allowance(), async () => { started.resolve(); await finish.promise; return 'late'; });
  await started.promise;
  await db.$transaction(tx => erasePrivacyShop(tx, shop));
  await db.session.create({ data: { id: `offline_${shop}`, shop, state: '', accessToken: 'synthetic-reinstalled-token', isOnline: false } });
  await competing.run(shop, order(1), allowance(), async () => 'new installation');
  finish.resolve(); await assert.rejects(pending, e => e.status === 409);
  assert.equal((await meter.status(shop, allowance())).used, 1);
  await db.$transaction(tx => applyRecoveryEvent(tx, { type: 'erase-customer', shop, orderIds: [order(1)], customerKey: null, emailKey: null }, now()));
  assert.equal(await db.usageOrder.count(), 0);
  await db.$transaction(tx => applyRecoveryEvent(tx, { type: 'erase-shop', shop }, now()));
  assert.equal(await db.usagePeriod.count(), 0);
  await assert.rejects(meter.run(shop, order(2), allowance(), async () => assert.fail()), e => e.status === 409);
});

test('completed reprints cannot deliver after customer erasure and old periods expire', async () => {
  await meter.run(shop, order(1), allowance(), async () => 'ok');
  const started = deferred(), finish = deferred();
  const pending = meter.run(shop, order(1), allowance(), async () => { started.resolve(); await finish.promise; return 'late'; });
  await started.promise;
  await db.$transaction(tx => applyRecoveryEvent(tx, { type: 'erase-customer', shop, orderIds: [order(1)], customerKey: null, emailKey: null }, now()));
  finish.resolve(); await assert.rejects(pending, e => e.status === 409);
  assert.equal((await pruneUsage(db, new Date('2026-11-29'))).count, 0);
  assert.equal((await pruneUsage(db, new Date('2026-12-01'))).count, 1);
});
