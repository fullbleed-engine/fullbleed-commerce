// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import { createRecoveryJournal } from '../../recovery-journal.js';
import { createOperatorAudit, operatorContextFromEnvironment, serviceAuditContext } from '../../operator-audit.js';
import { fileRecoveryStore } from '../scripts/recovery-store.mjs';
import { configuredDatabasePath, databaseUrl } from '../scripts/recovery-operations.mjs';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Use the isolated test runner.');
const target = resolve('../../target'), key = 'ef'.repeat(32), DAY = 86400000;
const context = { operator: 'synthetic-operator', purpose: 'maintenance', reference: 'OPS-20261004-TEST', operation: 'recovery.backup' };

async function fixture(t, now = () => new Date()) {
  await mkdir(target, { recursive: true });
  const directory = await mkdtemp(join(target, 'operator-test-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(target + sep + 'operator-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  const storeDirectory = join(directory, 'independent-store'), dataset = randomUUID();
  const store = await fileRecoveryStore(storeDirectory);
  const journal = createRecoveryJournal({ store, key, dataset, now });
  await journal.initialize();
  return { directory, storeDirectory, store, journal, dataset, audit: createOperatorAudit({ journal, now }), now };
}
const cli = (file, args, env) => spawnSync(process.execPath, [file, ...args], { cwd: resolve('.'), env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true, timeout: 60000 });
const environment = f => ({ FULLBLEED_RECOVERY_DIRECTORY: f.storeDirectory, FULLBLEED_RECOVERY_KEY: key,
  FULLBLEED_RECOVERY_DATASET: f.dataset, FULLBLEED_RECOVERY_ENDPOINT: '', RAILWAY_ENVIRONMENT_ID: '',
  FULLBLEED_OPERATOR_ID: context.operator, FULLBLEED_OPERATOR_PURPOSE: context.purpose, FULLBLEED_OPERATOR_REFERENCE: context.reference,
  FULLBLEED_PRIVACY_KEY: 'ab'.repeat(32), FULLBLEED_BACKUPS_ENABLED: 'false' });

test('operator receipts are encrypted outside SQLite, paired, create-only and retryable without changing an outcome', async t => {
  const f = await fixture(t);
  const { id, result } = await f.audit.run(context, async () => 'synthetic operation result');
  assert.equal(result, 'synthetic operation result');
  const [entry] = await f.audit.entries();
  assert.equal(entry.id, id); assert.equal(entry.outcome, 'completed');
  assert.equal(entry.started.identitySource, 'operator-environment');
  assert.equal(entry.started.operator, context.operator);
  assert.equal(entry.finished.operation, context.operation);
  assert.deepEqual(await f.audit.finish(id, 'completed', context.operator), entry.finished);
  await assert.rejects(f.audit.finish(id, 'failed', context.operator));
  await assert.rejects(f.audit.finish(id, 'completed', 'different-operator'));
  for (const path of await f.store.list('operator/')) {
    const bytes = await f.store.read(path, 4096);
    assert.doesNotMatch(bytes.toString(), /synthetic-operator|operation result|OPS-20261004|recovery.backup/);
  }
  assert.equal((await f.store.list('operator/')).length, 2);
});

test('unavailable storage, a wrong key, or a lost initial readback prevents the protected operation', async t => {
  const f = await fixture(t);
  let accessed = 0;
  const configurations = [
    { ...f.journal, verify: async () => { throw new Error('storage unavailable'); } },
    { ...f.journal, store: { ...f.store, write: async () => { throw new Error('write unavailable'); } } },
    { ...f.journal, store: { ...f.store, read: async () => { throw new Error('readback unavailable'); } } },
    createRecoveryJournal({ store: f.store, dataset: f.dataset, key: 'ab'.repeat(32) }),
  ];
  for (const journal of configurations) await assert.rejects(createOperatorAudit({ journal }).run(context, async () => { accessed++; }));
  assert.equal(accessed, 0);
  assert.equal((await f.audit.entries()).filter(entry => entry.outcome === 'incomplete').length, 1, 'A lost readback leaves an inspectable start but must not permit access.');
});

test('failure records contain no thrown error or operation result, and an end-write failure leaves an incomplete receipt', async t => {
  const f = await fixture(t);
  await assert.rejects(f.audit.run(context, async () => { throw new Error('synthetic-private-access-token'); }), /synthetic-private/);
  assert.equal((await f.audit.entries())[0].outcome, 'failed');
  assert.doesNotMatch(JSON.stringify(await f.audit.entries()), /synthetic-private-access-token/);
  let accessed = 0;
  const journal = { ...f.journal, store: { ...f.store, write: async (path, ...args) => {
    if (path.endsWith('/finished.bin')) throw new Error('completion storage unavailable');
    return f.store.write(path, ...args);
  } } };
  await assert.rejects(createOperatorAudit({ journal }).run(context, async () => { accessed++; return 'private result'; }));
  assert.equal(accessed, 1);
  const entries = await f.audit.entries();
  assert.equal(entries.filter(entry => entry.outcome === 'incomplete').length, 1);
  assert.doesNotMatch(JSON.stringify(entries), /private result|completion storage/);
});

test('concurrent operations retain independent starts and finishes', async t => {
  const f = await fixture(t);
  const calls = await Promise.all(Array.from({ length: 8 }, (_, i) => f.audit.run({ ...context, reference: `OPS-20261004-T${String(i).padStart(2, '0')}` }, async () => i)));
  assert.deepEqual(calls.map(call => call.result), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(calls.map(call => call.id)).size, 8);
  assert.equal((await f.audit.entries()).filter(entry => entry.outcome === 'completed').length, 8);
});

test('no arbitrary customer details, commands, or missing operator context are accepted', async t => {
  const f = await fixture(t);
  for (const bad of [
    { ...context, operator: 'person@example.test' }, { ...context, reference: 'Order #1001 for Jane Smith' },
    { ...context, purpose: 'arbitrary query text' }, { ...context, operation: 'exec arbitrary command' },
    { ...context, customerName: 'Synthetic Customer' }, { ...context, operator: undefined },
  ]) await assert.rejects(f.audit.start(bad));
  assert.throws(() => operatorContextFromEnvironment('privacy.status', {}));
  assert.equal((await f.store.list('operator/')).length, 0);
});

test('modified ciphertext, substituted paths, and inconsistent receipts cannot be read or pruned', async t => {
  let at = new Date('2026-09-01T12:00:00.000Z');
  const f = await fixture(t, () => at);
  const a = await f.audit.run(context, async () => null);
  const b = await f.audit.run(context, async () => null);
  const first = `operator/${a.id}/started.bin`, second = `operator/${b.id}/started.bin`;
  const original = await readFile(join(f.storeDirectory, first));
  await writeFile(join(f.storeDirectory, second), original);
  await assert.rejects(f.audit.entries());
  at = new Date(at.valueOf() + 31 * DAY);
  await assert.rejects(f.audit.prune());
  assert.equal((await f.store.list('operator/')).length, 4);
  original[original.length - 1] ^= 1;
  await writeFile(join(f.storeDirectory, first), original);
  await assert.rejects(f.audit.finish(a.id, 'completed', context.operator));
  const different = createRecoveryJournal({ store: f.store, key, dataset: randomUUID() });
  await assert.rejects(createOperatorAudit({ journal: different }).entries());
});

test('retention removes old receipts and can resume after an interrupted deletion', async t => {
  let at = new Date('2026-09-01T12:00:00.000Z');
  const f = await fixture(t, () => at);
  const old = await f.audit.run(context, async () => null);
  at = new Date(at.valueOf() + 31 * DAY);
  const recent = await f.audit.run(context, async () => null);
  const journal = { ...f.journal, store: { ...f.store, remove: async path => {
    if (path === `operator/${old.id}/started.bin`) throw new Error('interrupted deletion');
    return f.store.remove(path);
  } } };
  await assert.rejects(createOperatorAudit({ journal, now: () => at }).prune());
  const remaining = await f.audit.entries();
  assert.equal(remaining.find(entry => entry.id === old.id).outcome, 'incomplete');
  assert.deepEqual(await f.audit.prune(), { removed: 1 });
  assert.deepEqual((await f.audit.entries()).map(entry => entry.id), [recent.id]);
});

test('a killed or abandoned session remains visible and cannot be retroactively closed after a day', async t => {
  let at = new Date('2026-10-04T12:00:00.000Z');
  const f = await fixture(t, () => at);
  const id = await f.audit.start({ ...context, operation: 'console.railway' });
  at = new Date(at.valueOf() + DAY + 1);
  await assert.rejects(f.audit.finish(id, 'completed', context.operator));
  assert.equal((await f.audit.entries())[0].outcome, 'incomplete');
});

test('console CLI records begin/finish and its review detects an outstanding session', async t => {
  const f = await fixture(t), env = environment(f);
  const begin = cli('scripts/operator-audit.mjs', ['begin', '--surface', 'railway'], env);
  assert.equal(begin.status, 0, begin.stderr);
  const id = JSON.parse(begin.stdout).auditId;
  const review = cli('scripts/operator-audit.mjs', ['review'], env);
  assert.equal(review.status, 1, review.stderr);
  assert.equal(JSON.parse(review.stdout).result.incomplete, 1);
  assert.equal(cli('scripts/operator-audit.mjs', ['finish', '--id', id, '--outcome', 'completed'], env).status, 0);
  const finished = cli('scripts/operator-audit.mjs', ['review'], env);
  assert.equal(finished.status, 0, finished.stderr);
  assert.equal(JSON.parse(finished.stdout).result.incomplete, 0);
  const entries = await f.audit.entries();
  assert.equal(entries.length, 3); assert.ok(entries.every(entry => entry.outcome === 'completed'));
});

test('missing operator identity prevents recovery and privacy CLIs from opening a database', async t => {
  const f = await fixture(t), path = join(f.directory, 'must-not-be-created.sqlite');
  const env = { ...environment(f), DATABASE_URL: databaseUrl(path), FULLBLEED_OPERATOR_ID: '' };
  for (const [file, args] of [['scripts/recovery.mjs', ['backup']], ['scripts/privacy-status.mjs', []]]) {
    const result = cli(file, args, env);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    await assert.rejects(access(path), error => error.code === 'ENOENT');
  }
  assert.equal((await f.audit.entries()).length, 0);
});

test('real SQLite backup, isolated restore and privacy-status CLIs finish their receipts before returning results', async t => {
  const f = await fixture(t), path = join(f.directory, 'source.sqlite');
  const source = new DatabaseSync(configuredDatabasePath(process.env.DATABASE_URL), { readOnly: true });
  try { await backup(source, path); } finally { source.close(); }
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl(path) } } });
  try {
    await db.$transaction(async tx => {
      await tx.privacyRequest.deleteMany(); await tx.automationSettings.deleteMany(); await tx.session.deleteMany();
      await tx.brand.deleteMany(); await tx.documentTemplate.deleteMany(); await tx.recoveryReceipt.deleteMany();
      await tx.usagePeriod.deleteMany(); await tx.accessEvent.deleteMany();
      await tx.session.create({ data: { id: 'offline_synthetic-operator.myshopify.com', shop: 'synthetic-operator.myshopify.com', state: '', isOnline: false, accessToken: 'synthetic-secret-never-in-audit' } });
    });
  } finally { await db.$disconnect(); }
  const env = { ...environment(f), DATABASE_URL: databaseUrl(path) };
  const saved = cli('scripts/recovery.mjs', ['backup'], env);
  assert.equal(saved.status, 0, saved.stderr);
  const savedRecord = JSON.parse(saved.stdout);
  const restore = cli('scripts/recovery.mjs', ['restore', '--backup', savedRecord.result.id, '--output', join(f.directory, 'quarantine')], env);
  assert.equal(restore.status, 0, restore.stderr);
  assert.equal(JSON.parse(restore.stdout).result.sessionsCleared, true);
  const status = cli('scripts/privacy-status.mjs', [], env);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).keyMismatch, 0);
  const entries = await f.audit.entries();
  assert.equal(entries.length, 3); assert.ok(entries.every(entry => entry.outcome === 'completed'));
  for (const result of [saved, restore, status]) {
    const id = JSON.parse(result.stdout).auditId;
    assert.ok(entries.some(entry => entry.id === id && entry.finished));
  }
  assert.doesNotMatch(JSON.stringify(entries), /synthetic-secret-never-in-audit|synthetic-operator.myshopify.com|source.sqlite|quarantine/);
  for (const command of ['reconcile', 'maintain']) {
    const run = cli('scripts/recovery.mjs', [command, '--service'], { ...env, FULLBLEED_OPERATOR_ID: '' });
    assert.equal(run.status, 0, run.stderr);
    const receipt = (await f.audit.entries()).find(entry => entry.id === JSON.parse(run.stdout).auditId);
    assert.equal(receipt.finished.operator, 'fullbleed-maintenance');
    assert.equal(receipt.finished.identitySource, 'service-process');
    assert.equal(receipt.outcome, 'completed');
  }
});

test('scheduled operations have a service identity and cannot use it for manual backup or restore', async t => {
  const f = await fixture(t);
  const service = serviceAuditContext('recovery.maintain');
  await f.audit.run(service, async () => null);
  const [entry] = await f.audit.entries();
  assert.equal(entry.started.operator, 'fullbleed-maintenance');
  assert.equal(entry.started.identitySource, 'service-process');
  assert.throws(() => serviceAuditContext('recovery.restore'));
  assert.throws(() => operatorContextFromEnvironment('recovery.backup', { ...environment(f), FULLBLEED_OPERATOR_ID: 'fullbleed-maintenance' }));
  for (const command of ['backup', 'list', 'status', 'init']) {
    const result = cli('scripts/recovery.mjs', [command, '--service'], { ...environment(f), FULLBLEED_OPERATOR_ID: '' });
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  }
});

test('retention lists but does not re-download fresh operator receipts', async t => {
  const f = await fixture(t);
  await f.audit.run(context, async () => null);
  let receiptReads = 0;
  const journal = { ...f.journal, store: { ...f.store, read: async (path, ...args) => {
    if (path.startsWith('operator/')) receiptReads++;
    return f.store.read(path, ...args);
  } } };
  assert.deepEqual(await createOperatorAudit({ journal }).prune(), { removed: 0 });
  assert.equal(receiptReads, 0);
});
