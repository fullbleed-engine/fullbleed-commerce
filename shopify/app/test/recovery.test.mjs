// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, rm, readFile, writeFile, stat, mkdir, utimes, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createRecoveryJournal } from '../../recovery-journal.js';
import { createPrivacyService, completePrivacyRequest, erasePrivacyShop, parsePrivacyPayload, applyRecoveryEvent } from '../../privacy.js';
import { fileRecoveryStore } from '../scripts/recovery-store.mjs';
import { configuredDatabasePath, databaseUrl, createDatabaseBackup, restoreDatabaseBackup, pruneRecoveryStorage, pruneAbandonedSnapshots } from '../scripts/recovery-operations.mjs';
import { backupsEnabled, backupStatus, maintainBackups } from '../scripts/backup-maintenance.mjs';
import { createUsageMeter, developmentAllowance } from '../../usage.js';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Use the isolated test runner.');
const privacyKey = 'ab'.repeat(32), key = 'ef'.repeat(32);
const primary = 'synthetic-recovery-primary.myshopify.com', other = 'synthetic-recovery-other.myshopify.com';
const completed = 'synthetic-recovery-completed.myshopify.com', removed = 'synthetic-recovery-removed.myshopify.com';
const target = resolve('../../target');
const input = (shop, order = '1') => parsePrivacyPayload(Buffer.from(JSON.stringify({ shop_domain: shop, shop_id: '1', customer: { id: '9000', email: 'synthetic-recovery@example.invalid' }, data_request: { id: '7000' }, orders_requested: [order] })), shop, 'CUSTOMERS_DATA_REQUEST');

async function fixture(t, now = () => new Date()) {
  const directory = await mkdtemp(join(target, 'recovery-test-'));
  const path = join(directory, 'source.sqlite');
  const source = new DatabaseSync(configuredDatabasePath(process.env.DATABASE_URL), { readOnly: true });
  try { await backup(source, path); } finally { source.close(); }
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl(path) } } });
  const clients = [db];
  t.after(async () => {
    await Promise.all(clients.map(client => client.$disconnect()));
    assert.ok(resolve(directory).startsWith(target + sep + 'recovery-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  await db.$transaction(async tx => {
    await tx.privacyRequest.deleteMany(); await tx.automationSettings.deleteMany(); await tx.session.deleteMany();
    await tx.brand.deleteMany(); await tx.documentTemplate.deleteMany(); await tx.recoveryReceipt.deleteMany();
    await tx.usagePeriod.deleteMany();
    await tx.accessEvent.deleteMany();
  });
  const storeDirectory = join(directory, 'independent-store');
  const store = await fileRecoveryStore(storeDirectory), dataset = randomUUID();
  const journal = createRecoveryJournal({ store, key, dataset, now });
  await journal.initialize();
  const service = createPrivacyService({ db, key: privacyKey, now, recordRecovery: journal.record });
  const requests = {};
  for (const shop of [primary, other, completed, removed]) {
    await db.session.create({ data: { id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-recovery-access-token' } });
    await db.brand.create({ data: { shop, sellerName: 'Synthetic saved recovery brand' } });
    await db.documentTemplate.create({ data: { shop, kind: 'order-summary', revision: 'synthetic-saved-revision', content: '{"html":"<h1>Saved template</h1>"}' } });
    await db.automationSettings.create({ data: { shop, enabled: true, jobs: { create: {
      runId: 'synthetic-recovery-run', handle: 'create-order-summary-link', orderId: 'gid://shopify/Order/1', kind: 'order-summary', requestHash: 'synthetic-request-hash', ttlHours: 24,
      retryDeadline: new Date(now().valueOf() + 3600000), status: 'ready', expiresAt: new Date(now().valueOf() + 3600000),
    } } } });
    await createUsageMeter({ db, now }).run(shop, 'gid://shopify/Order/1', developmentAllowance(now()), async () => 'synthetic document');
    requests[shop] = await service.accept(input(shop));
    await db.accessEvent.create({ data: { shop, actorType: 'staff', actorId: '42', operation: 'document.render', orderId: 'gid://shopify/Order/1', outcome: 'completed', startedAt: now(), finishedAt: now() } });
    await db.accessEvent.create({ data: { shop, actorType: 'staff', actorId: '42', operation: 'privacy.export', requestId: requests[shop], outcome: 'completed', startedAt: now(), finishedAt: now() } });
  }
  const connect = path => { const client = new PrismaClient({ datasources: { db: { url: databaseUrl(path) } } }); clients.push(client); return client; };
  return { directory, path, db, journal, store, storeDirectory, dataset, service, requests, connect };
}

test('encrypted multipart backup restores retained data and replays later erasure, completion and uninstall', async t => {
  const f = await fixture(t);
  await f.db.brand.update({ where: { shop: other }, data: { sellerLines: 'Synthetic recovery design content. '.repeat(70000) } });
  const saved = await createDatabaseBackup({ db: f.db, databasePath: f.path, journal: f.journal });
  assert.ok(saved.parts > 1);
  await f.service.redact({ shop: primary, customerId: null, email: 'synthetic-recovery@example.invalid', orderIds: [] });
  await f.service.exportData(completed, f.requests[completed]);
  await completePrivacyRequest(f.db, completed, f.requests[completed], new Date(), f.journal.record);
  await f.db.$transaction(tx => erasePrivacyShop(tx, removed, f.journal.record));
  const entries = await f.journal.entries();
  assert.equal(entries.length, 3);
  assert.doesNotMatch(JSON.stringify(entries), /synthetic-recovery@example|synthetic-recovery-access-token/);
  for (const prefix of ['journal/', 'backups/']) for (const path of await f.store.list(prefix)) {
    const bytes = await f.store.read(path, 2 * 1024 * 1024);
    assert.doesNotMatch(bytes.toString(), /SQLite format|synthetic-recovery-primary|synthetic-recovery@example|synthetic-recovery-access-token|Saved template/);
  }
  const output = join(f.directory, 'restored');
  const report = await restoreDatabaseBackup({ journal: f.journal, id: saved.id, outputDirectory: output, privacyKey });
  assert.equal(report.sourceSha256, saved.sha256); assert.equal(report.replay.applied, 3);
  assert.equal(report.outstandingPrivacyRequests, 1);
  assert.equal(report.authenticatedPrivacySnapshots, 1);
  const restored = f.connect(join(output, 'commerce.sqlite'));
  const erased = await restored.privacyRequest.findUnique({ where: { id: f.requests[primary] } });
  assert.equal(erased.status, 'redacted'); assert.equal(erased.snapshot, null);
  assert.equal((await restored.automationJob.findFirst({ where: { shop: primary } })).orderId, '');
  assert.equal((await restored.privacyRequest.findUnique({ where: { id: f.requests[completed] } })).snapshot, null);
  assert.equal(await restored.brand.count({ where: { shop: removed } }), 0);
  assert.equal(await restored.documentTemplate.count({ where: { shop: removed } }), 0);
  assert.equal(await restored.usagePeriod.count({ where: { shop: removed } }), 0);
  assert.equal(await restored.usageOrder.count({ where: { shop: primary } }), 0);
  assert.equal((await restored.usagePeriod.findFirst({ where: { shop: primary } })).used, 1);
  assert.equal(await restored.usageOrder.count({ where: { shop: other } }), 1);
  assert.equal(await restored.accessEvent.count({ where: { shop: primary } }), 0);
  assert.equal(await restored.accessEvent.count({ where: { shop: removed } }), 0);
  assert.equal(await restored.accessEvent.count({ where: { shop: completed, requestId: { not: null } } }), 0);
  assert.equal(await restored.accessEvent.count({ where: { shop: other } }), 2);
  assert.equal((await restored.brand.findUnique({ where: { shop: other } })).sellerName, 'Synthetic saved recovery brand');
  assert.match((await restored.documentTemplate.findFirst({ where: { shop: other } })).content, /Saved template/);
  const exportData = await createPrivacyService({ db: restored, key: privacyKey }).exportData(other, f.requests[other]);
  assert.equal(exportData.customer.email, 'synthetic-recovery@example.invalid');
  assert.equal(exportData.orderUsage.length, 1);
  assert.equal(await restored.session.count(), 0);
  assert.equal(await restored.automationSettings.count({ where: { enabled: true } }), 0);
  assert.equal(await restored.automationJob.count({ where: { status: 'ready' } }), 0);
  assert.equal((await f.journal.replay(restored, applyRecoveryEvent)).applied, 0);
  assert.equal((await f.db.session.count()), 3, 'Restore must not replace the source database.');
  if (process.platform !== 'win32') {
    assert.equal((await stat(output)).mode & 0o077, 0);
    assert.equal((await stat(join(output, 'commerce.sqlite'))).mode & 0o077, 0);
  }
});

test('a durable erasure survives a failed original database commit and replays exactly once', async t => {
  const f = await fixture(t);
  await assert.rejects(f.db.$transaction(async tx => {
    await erasePrivacyShop(tx, primary, f.journal.record);
    throw new Error('Synthetic commit failure.');
  }), /Synthetic commit failure/);
  assert.equal(await f.db.brand.count({ where: { shop: primary } }), 1);
  assert.equal((await f.journal.entries()).length, 1);
  assert.equal(await f.db.recoveryReceipt.count(), 0);
  assert.equal((await f.journal.replay(f.db, applyRecoveryEvent)).applied, 1);
  assert.equal(await f.db.brand.count({ where: { shop: primary } }), 0);
  assert.equal((await f.journal.replay(f.db, applyRecoveryEvent)).applied, 0);
  assert.equal(await f.db.brand.count({ where: { shop: other } }), 1);
});

test('restoration migrates backups from before usage and audit tables before replaying erasure', async t => {
  const f = await fixture(t);
  await f.db.$executeRawUnsafe('DROP TABLE "UsageOrder"');
  await f.db.$executeRawUnsafe('DROP TABLE "UsagePeriod"');
  await f.db.$executeRawUnsafe('DROP TABLE "AccessEvent"');
  await f.db.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261004020000_order_allowances'`;
  await f.db.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261004083000_access_events'`;
  const saved = await createDatabaseBackup({ db: f.db, databasePath: f.path, journal: f.journal });
  // The retained intent is durable even though the old source schema cannot
  // apply a new-version erasure. Recovery must migrate, then apply the intent.
  await assert.rejects(f.db.$transaction(tx => erasePrivacyShop(tx, removed, f.journal.record)));
  const output = join(f.directory, 'migrated-restore');
  const report = await restoreDatabaseBackup({ journal: f.journal, id: saved.id, outputDirectory: output, privacyKey });
  assert.equal(report.replay.applied, 1);
  const restored = f.connect(join(output, 'commerce.sqlite'));
  assert.equal(await restored.usagePeriod.count(), 0);
  assert.equal(await restored.usageOrder.count(), 0);
  assert.equal(await restored.accessEvent.count(), 0);
  assert.equal(await restored.brand.count({ where: { shop: removed } }), 0);
});

test('unavailable recovery storage rolls back erasure without accepting a receipt', async t => {
  const f = await fixture(t);
  const unavailable = createRecoveryJournal({ store: { ...f.store, write: async () => { throw new Error('Synthetic storage outage.'); } }, key, dataset: f.dataset });
  await assert.rejects(f.db.$transaction(tx => erasePrivacyShop(tx, primary, unavailable.record)));
  assert.equal(await f.db.brand.count({ where: { shop: primary } }), 1);
  assert.equal(await f.db.recoveryReceipt.count(), 0);
  assert.equal((await f.journal.entries()).length, 0);
});

test('wrong key or dataset, modified ciphertext and expired backups cannot produce a restore', async t => {
  const f = await fixture(t);
  const saved = await createDatabaseBackup({ db: f.db, databasePath: f.path, journal: f.journal });
  for (const configuration of [{ key: 'cd'.repeat(32), dataset: f.dataset }, { key, dataset: randomUUID() }]) {
    const wrong = createRecoveryJournal({ store: f.store, ...configuration });
    await assert.rejects(restoreDatabaseBackup({ journal: wrong, id: saved.id, outputDirectory: join(f.directory, 'wrong'), privacyKey }));
  }
  await assert.rejects(restoreDatabaseBackup({ journal: f.journal, id: saved.id, outputDirectory: join(f.directory, 'expired'), privacyKey, now: () => new Date(Date.now() + 8 * 86400000) }));
  const part = join(f.storeDirectory, `backups/${saved.id}/0000.bin`);
  const bytes = await readFile(part); bytes[bytes.length - 1] ^= 1; await writeFile(part, bytes);
  await assert.rejects(restoreDatabaseBackup({ journal: f.journal, id: saved.id, outputDirectory: join(f.directory, 'tampered'), privacyKey }));
  await assert.rejects(stat(join(f.directory, 'tampered')), error => error.code === 'ENOENT');
  assert.equal(await f.db.brand.count(), 4);
});

test('corrupted journal fails before replay changes records, and a database rejects a different valid dataset', async t => {
  const f = await fixture(t);
  await f.journal.bind(f.db);
  const second = createRecoveryJournal({ store: await fileRecoveryStore(join(f.directory, 'second-store')), key, dataset: randomUUID() });
  await second.initialize();
  await assert.rejects(second.bind(f.db));
  await assert.rejects(f.db.$transaction(async tx => { await f.journal.record(tx, { type: 'erase-shop', shop: primary }); throw new Error('Rollback.'); }));
  const [entry] = await f.journal.entries();
  const path = join(f.storeDirectory, entry.path), bytes = await readFile(path);
  bytes[20] ^= 1; await writeFile(path, bytes);
  await assert.rejects(f.journal.replay(f.db, applyRecoveryEvent));
  assert.equal(await f.db.brand.count({ where: { shop: primary } }), 1);
});

test('an already-bound dataset can be verified while another client holds a write transaction', async t => {
  const f = await fixture(t);
  await f.journal.bind(f.db);
  const second = f.connect(f.path);
  await f.db.$transaction(async tx => {
    await tx.brand.update({ where: { shop: primary }, data: { sellerName: 'Uncommitted synthetic update' } });
    // This must finish before the writer can commit; another interactive
    // transaction would wait for its lock and time out instead.
    await f.journal.bind(second);
    assert.equal(await second.recoveryReceipt.count({ where: { id: `dataset:${f.dataset}` } }), 1);
  }, { timeout: 10000 });
  assert.equal((await f.db.brand.findUniqueOrThrow({ where: { shop: primary } })).sellerName, 'Uncommitted synthetic update');
});

test('read-only binding verification still rejects extra dataset markers and unavailable storage', async t => {
  const f = await fixture(t);
  await f.journal.bind(f.db);
  const unavailable = createRecoveryJournal({ store: { ...f.store, read: async () => { throw new Error('Synthetic storage outage.'); } }, key, dataset: f.dataset });
  await assert.rejects(unavailable.bind(f.db));
  await f.db.recoveryReceipt.create({ data: { id: `dataset:${randomUUID()}` } });
  await assert.rejects(f.journal.bind(f.db));
});

test('retention removes expired backups and applied recovery events while retaining the dataset binding', async t => {
  let at = Date.now() - 40 * 86400000;
  const f = await fixture(t, () => new Date(at));
  const saved = await createDatabaseBackup({ db: f.db, databasePath: f.path, journal: f.journal, now: () => new Date(at) });
  await f.db.$transaction(tx => erasePrivacyShop(tx, primary, f.journal.record));
  at = Date.now();
  const pruned = await pruneRecoveryStorage({ journal: f.journal, db: f.db, now: new Date(at) });
  assert.equal(pruned.removedEvents, 1); assert.equal(pruned.removedBackupObjects, saved.parts + 1);
  assert.deepEqual(await f.store.list('backups/'), []); assert.deepEqual(await f.journal.entries(), []);
  assert.equal(await f.db.recoveryReceipt.count(), 1);
  assert.equal(await f.db.brand.count({ where: { shop: primary } }), 0);
  await f.journal.verify();
});

test('a valid SQLite backup with a damaged privacy snapshot remains unpublishable', async t => {
  const f = await fixture(t);
  const row = await f.db.privacyRequest.findUniqueOrThrow({ where: { id: f.requests[other] } });
  const fields = row.snapshot.split('.');
  const cipher = Buffer.from(fields[3], 'base64url'); cipher[0] ^= 1; fields[3] = cipher.toString('base64url');
  await f.db.privacyRequest.update({ where: { id: row.id }, data: { snapshot: fields.join('.') } });
  const saved = await createDatabaseBackup({ db: f.db, databasePath: f.path, journal: f.journal });
  const output = join(f.directory, 'invalid-private-export');
  await assert.rejects(restoreDatabaseBackup({ journal: f.journal, id: saved.id, outputDirectory: output, privacyKey }));
  await assert.rejects(stat(output), error => error.code === 'ENOENT');
  assert.equal((await f.db.privacyRequest.findUniqueOrThrow({ where: { id: row.id } })).exports, 0);
});

test('scheduled backups survive restarts, renew at 24 hours and catch up after downtime', async t => {
  let at = Date.now();
  const f = await fixture(t, () => new Date(at));
  const run = () => maintainBackups({ db: f.db, databasePath: f.path, journal: f.journal, enabled: true, now: () => new Date(at) });
  assert.equal((await backupStatus({ journal: f.journal, enabled: true, now: new Date(at) })).status, 'missing');
  const first = await run();
  assert.equal(first.backupCreated, true); assert.ok(first.backup.verifiedAt);
  assert.equal(first.backups.status, 'fresh');
  // A new caller has no in-memory clock or cached backup state.
  assert.equal((await run()).backupCreated, false);
  at += 24 * 3600000 - 1000;
  assert.equal((await run()).backupCreated, false);
  at += 1000;
  const daily = await run(); assert.equal(daily.backupCreated, true); assert.notEqual(daily.backup.id, first.backup.id);
  at += 27 * 3600000;
  assert.equal((await backupStatus({ journal: f.journal, enabled: true, now: new Date(at) })).status, 'stale');
  const recovered = await run(); assert.equal(recovered.backupCreated, true); assert.equal(recovered.backups.status, 'fresh');
  at += 9 * 86400000;
  const afterDowntime = await run();
  assert.equal(afterDowntime.backupCreated, true);
  assert.equal(afterDowntime.retention.removedBackupObjects, first.backup.parts + daily.backup.parts + recovered.backup.parts + 3);
});

test('disabled or invalid schedule configuration cannot report a healthy backup', async t => {
  const f = await fixture(t);
  for (const value of [undefined, '', '1', 'TRUE']) assert.throws(() => backupsEnabled({ FULLBLEED_BACKUPS_ENABLED: value }));
  assert.equal(backupsEnabled({ FULLBLEED_BACKUPS_ENABLED: 'true' }), true);
  assert.equal(backupsEnabled({ FULLBLEED_BACKUPS_ENABLED: 'false' }), false);
  const result = await maintainBackups({ db: f.db, databasePath: f.path, journal: f.journal, enabled: false });
  assert.equal(result.backupCreated, false); assert.deepEqual(result.backups, { status: 'disabled', snapshotAt: null, ageSeconds: null });
  assert.deepEqual(await f.store.list('backups/'), []);
});

test('a failed upload or corrupted readback cannot publish a new verified snapshot and the next attempt recovers', async t => {
  let at = Date.now();
  const f = await fixture(t, () => new Date(at));
  const first = await createDatabaseBackup({ db: f.db, databasePath: f.path, journal: f.journal, now: () => new Date(at) });
  at += 27 * 3600000;
  for (const mode of ['failed-put', 'damaged-readback']) {
    const badStore = { ...f.store,
      write: async (path, ...args) => { if (mode === 'failed-put' && path.startsWith('backups/')) throw new Error('Synthetic outage.'); return f.store.write(path, ...args); },
      read: async (path, ...args) => { const bytes = await f.store.read(path, ...args); if (mode === 'damaged-readback' && /^backups\/.*\/0000\.bin$/.test(path)) bytes[32] ^= 1; return bytes; },
    };
    const journal = createRecoveryJournal({ store: badStore, key, dataset: f.dataset, now: () => new Date(at) });
    await assert.rejects(maintainBackups({ db: f.db, databasePath: f.path, journal, enabled: true, now: () => new Date(at) }));
    assert.deepEqual((await f.store.list('backups/')).filter(path => path.endsWith('/manifest.bin')), [`backups/${first.id}/manifest.bin`]);
    assert.equal((await backupStatus({ journal: f.journal, enabled: true, now: new Date(at) })).status, 'stale');
  }
  assert.equal((await maintainBackups({ db: f.db, databasePath: f.path, journal: f.journal, enabled: true, now: () => new Date(at) })).backups.status, 'fresh');
});

test('freshness inspection is read-only and rejects missing parts or corrupted manifests', async t => {
  const f = await fixture(t);
  const saved = await createDatabaseBackup({ db: f.db, databasePath: f.path, journal: f.journal });
  const readonly = createRecoveryJournal({ store: { ...f.store, write: () => assert.fail('No write permitted.'), remove: () => assert.fail('No removal permitted.') }, key, dataset: f.dataset });
  assert.equal((await backupStatus({ journal: readonly, enabled: true })).status, 'fresh');
  const part = `backups/${saved.id}/0000.bin`, bytes = await f.store.read(part, 2 * 1024 * 1024);
  await f.store.remove(part);
  await assert.rejects(backupStatus({ journal: readonly, enabled: true }));
  await f.store.write(part, bytes);
  const manifest = join(f.storeDirectory, `backups/${saved.id}/manifest.bin`);
  const content = await readFile(manifest); content[32] ^= 1; await writeFile(manifest, content);
  await assert.rejects(backupStatus({ journal: readonly, enabled: true }));
});

test('old manifests remain restorable but do not satisfy verified-backup monitoring', async t => {
  const f = await fixture(t);
  const saved = await createDatabaseBackup({ db: f.db, databasePath: f.path, journal: f.journal });
  const path = `backups/${saved.id}/manifest.bin`;
  const manifest = JSON.parse(f.journal.codec.open(path, await f.store.read(path, 128 * 1024)));
  delete manifest.verifiedAt;
  await writeFile(join(f.storeDirectory, path), f.journal.codec.seal(path, Buffer.from(JSON.stringify(manifest))));
  assert.equal((await backupStatus({ journal: f.journal, enabled: true })).status, 'unverified');
  assert.equal((await restoreDatabaseBackup({ journal: f.journal, id: saved.id, outputDirectory: join(f.directory, 'legacy'), privacyKey })).integrityChecked, true);
  const result = await maintainBackups({ db: f.db, databasePath: f.path, journal: f.journal, enabled: true });
  assert.equal(result.backupCreated, true); assert.equal(result.backups.status, 'fresh');
});

test('interrupted snapshot cleanup removes only old owned copies and preserves active or unrelated files', async t => {
  const f = await fixture(t);
  const old = new Date(Date.now() - 25 * 3600000);
  const abandoned = join(f.directory, '.fullbleed-backup-old001');
  const active = join(f.directory, '.fullbleed-backup-new001');
  const unrelated = join(f.directory, 'another-backup');
  for (const directory of [abandoned, active, unrelated]) {
    await mkdir(directory, { mode: 0o700 });
    const path = join(directory, 'snapshot.sqlite');
    await writeFile(path, 'Synthetic interrupted private snapshot.', { mode: 0o600 });
    if (directory !== active) await utimes(path, old, old);
    await utimes(directory, old, old);
  }
  assert.equal(await pruneAbandonedSnapshots(f.path), 1);
  assert.ok((await readdir(f.directory)).includes('another-backup'));
  assert.ok((await readdir(f.directory)).includes('.fullbleed-backup-new001'));
  assert.equal(await f.db.brand.count(), 4);
});
