import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createRequestHandler } from 'react-router';
import { createPrivacyService, parsePrivacyPayload } from '../../privacy.js';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createRecoveryJournal } from '../../recovery-journal.js';
import { recoveryStoreFromEnvironment } from '../scripts/recovery-store.mjs';
import { createDatabaseBackup, configuredDatabasePath } from '../scripts/recovery-operations.mjs';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret' || process.env.FULLBLEED_PRIVACY_KEY !== 'ab'.repeat(32)) throw new Error('Use the isolated Shopify test runner.');
const db = new PrismaClient();
const handler = createRequestHandler(await import('../build/server/index.js'), 'production');
const token = 'cd'.repeat(32);
const shop = 'synthetic-monitor.myshopify.com';
const originalFetch = globalThis.fetch;
const journal = createRecoveryJournal({ store: await recoveryStoreFromEnvironment(), key: process.env.FULLBLEED_RECOVERY_KEY, dataset: process.env.FULLBLEED_RECOVERY_DATASET });
let saved;
globalThis.fetch = () => { throw new Error('Operator monitoring must not call Shopify or billing.'); };
const request = (authorization = `Bearer ${token}`, query = '') => handler(new Request(`https://fullbleed-test.invalid/internal/monitor${query}`, { headers: authorization ? { Authorization: authorization } : {} }));
async function seed() {
  return createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY }).accept(parsePrivacyPayload(Buffer.from(JSON.stringify({
    shop_domain: shop, shop_id: 1, customer: { id: 9000, email: 'synthetic-monitor@example.invalid' }, data_request: { id: 7000 }, orders_requested: [],
  })), shop, 'CUSTOMERS_DATA_REQUEST'));
}
test.before(async () => {
  saved = await createDatabaseBackup({ db, databasePath: configuredDatabasePath(process.env.DATABASE_URL), journal });
});
test.beforeEach(async () => {
  process.env.FULLBLEED_BACKUPS_ENABLED = 'true';
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
  assert.deepEqual(Object.keys(body).sort(), ['backups', 'checkedAt', 'privacy', 'status']);
  assert.deepEqual(body.privacy, { pending: 1, overdue: 0, dueWithin48Hours: 0, keyMismatch: 0 });
  assert.equal(body.backups.status, 'fresh'); assert.equal(body.backups.snapshotAt, saved.createdAt);
  assert.doesNotMatch(JSON.stringify(body), /synthetic|9000|7000|"snapshot":|customer|order|export|accessToken/);
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

test('independent recovery storage failure makes the private monitor unhealthy', async () => {
  const directory = process.env.FULLBLEED_RECOVERY_DIRECTORY;
  assert.match(directory, /webhook-recovery-/);
  const marker = join(directory, 'dataset.bin'), held = join(directory, '.synthetic-monitor-held');
  await rename(marker, held);
  try {
    const response = await request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable' });
  } finally { await rename(held, marker); }
  assert.equal((await request()).status, 200);
});

test('disabled or absent backup scheduling cannot appear healthy', async () => {
  process.env.FULLBLEED_BACKUPS_ENABLED = 'false';
  let response = await request();
  assert.equal(response.status, 503); assert.deepEqual((await response.json()).backups, { status: 'disabled', snapshotAt: null, ageSeconds: null });
  delete process.env.FULLBLEED_BACKUPS_ENABLED;
  response = await request();
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { status: 'unavailable' });
});

test('missing and stale snapshots fail private monitoring without affecting public readiness', async () => {
  const directory = process.env.FULLBLEED_RECOVERY_DIRECTORY;
  const path = join(directory, `backups/${saved.id}/manifest.bin`), held = join(directory, '.synthetic-backup-held');
  await rename(path, held);
  let old;
  try {
    let response = await request();
    assert.equal(response.status, 503); assert.equal((await response.json()).backups.status, 'missing');
    old = await createDatabaseBackup({ db, databasePath: configuredDatabasePath(process.env.DATABASE_URL), journal, now: () => new Date(Date.now() - 27 * 3600000) });
    response = await request();
    assert.equal(response.status, 503); assert.equal((await response.json()).backups.status, 'stale');
    assert.equal((await handler(new Request('https://fullbleed-test.invalid/health'))).status, 200);
  } finally {
    if (old) for (const object of await journal.store.list(`backups/${old.id}/`)) await journal.store.remove(object);
    await rename(held, path);
  }
  assert.equal((await request()).status, 200);
});
