// SPDX-License-Identifier: MIT
import { DatabaseSync, backup } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, open, lstat, chmod, unlink, rmdir, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { applyRecoveryEvent, createPrivacyService, prunePrivacyRequests } from '../../privacy.js';
import { pruneAutomationJobs } from '../../flow.js';
import { pruneUsage } from '../../usage.js';
import { pruneAccessEvents } from '../../access-audit.js';
import { BACKUP_RETENTION_DAYS, RECOVERY_RETENTION_DAYS, recoveryFailure } from '../../recovery-journal.js';

const DAY = 86400000, PART_SIZE = 1024 * 1024, MAX_DATABASE_BYTES = 512 * PART_SIZE;
const backupIdPattern = /^\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const databaseUrl = path => `file:${path.replaceAll('\\', '/')}`;
export function configuredDatabasePath(value) {
  const path = value?.startsWith('file:') ? value.slice(5) : '';
  if (!isAbsolute(path) || path.includes('?') || path.includes('#')) throw recoveryFailure();
  return path;
}
function inspectDatabase(path, compact = false) {
  const sql = new DatabaseSync(path, { readOnly: !compact, timeout: 1000 });
  try {
    if (compact) sql.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; VACUUM;');
    const integrity = sql.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || sql.prepare('PRAGMA foreign_key_check').all().length) throw recoveryFailure();
    const required = ['Session','Brand','DocumentTemplate','AutomationSettings','AutomationJob','PrivacyRequest','PrivacyRequestOrder','RecoveryReceipt'];
    const tables = new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (!required.every(name => tables.has(name))) throw recoveryFailure();
  } finally { sql.close(); }
}
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function privateJson(path, data) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(data, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}

export async function createDatabaseBackup({ db, databasePath, journal, now = () => new Date() }) {
  if (!isAbsolute(databasePath)) throw recoveryFailure();
  const sourceStat = await lstat(databasePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > MAX_DATABASE_BYTES) throw recoveryFailure();
  await journal.replay(db, applyRecoveryEvent);
  const at = now(), id = `${at.valueOf()}-${randomUUID()}`;
  const temporary = await mkdtemp(join(dirname(databasePath), '.fullbleed-backup-'));
  const snapshot = join(temporary, 'snapshot.sqlite');
  const source = new DatabaseSync(databasePath, { readOnly: true, timeout: 1000 });
  try {
    // A consistent SQLite snapshot, including committed WAL content. Never cp a
    // live database file. Continuous writers can restart copying; bound the run.
    const started = Date.now();
    const pageSize = source.prepare('PRAGMA page_size').get().page_size;
    await backup(source, snapshot, { rate: 256, progress: ({ totalPages }) => {
      if (Date.now() - started > 60000 || totalPages * pageSize > MAX_DATABASE_BYTES) throw recoveryFailure();
    } });
    source.close();
    await chmod(snapshot, 0o600);
    inspectDatabase(snapshot);
    const bytes = (await lstat(snapshot)).size;
    if (bytes > MAX_DATABASE_BYTES) throw recoveryFailure();
    const parts = [], hash = createHash('sha256');
    let observedBytes = 0;
    for await (const chunk of createReadStream(snapshot, { highWaterMark: PART_SIZE })) {
      const path = `backups/${id}/${String(parts.length).padStart(4, '0')}.bin`;
      hash.update(chunk); observedBytes += chunk.length;
      parts.push({ bytes: chunk.length, sha256: sha256(chunk) });
      await journal.store.write(path, journal.codec.seal(path, chunk), { exclusive: true });
      // Authenticate and compare stored bytes before publishing the manifest.
      const stored = journal.codec.open(path, await journal.store.read(path, PART_SIZE + 32));
      if (stored.length !== chunk.length || sha256(stored) !== parts.at(-1).sha256) throw recoveryFailure();
    }
    if (observedBytes !== bytes) throw recoveryFailure();
    const manifest = { format: 'fullbleed-sqlite-backup-v1', dataset: journal.dataset, id, createdAt: at.toISOString(), verifiedAt: now().toISOString(), bytes, sha256: hash.digest('hex'), parts };
    const path = `backups/${id}/manifest.bin`;
    // Publish last. An interrupted upload never becomes a listed usable backup.
    await journal.store.write(path, journal.codec.seal(path, Buffer.from(JSON.stringify(manifest))), { exclusive: true });
    const storedManifest = await readBackupManifest(journal, id, now());
    if (JSON.stringify(storedManifest) !== JSON.stringify(manifest)) throw recoveryFailure();
    return { id, createdAt: manifest.createdAt, verifiedAt: manifest.verifiedAt, bytes, parts: parts.length, sha256: manifest.sha256, retentionDays: BACKUP_RETENTION_DAYS };
  } finally {
    if (source.isOpen) source.close();
    for (const suffix of ['', '-wal', '-shm', '-journal']) await unlink(snapshot + suffix).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(temporary);
  }
}

export async function readBackupManifest(journal, id, now = new Date(), allowExpired = false) {
  if (!backupIdPattern.test(id || '')) throw recoveryFailure();
  const path = `backups/${id}/manifest.bin`;
  let manifest;
  try { manifest = JSON.parse(journal.codec.open(path, await journal.store.read(path, 128 * 1024)).toString('utf8')); }
  catch { throw recoveryFailure(); }
  const created = Date.parse(manifest.createdAt);
  if (manifest.format !== 'fullbleed-sqlite-backup-v1' || manifest.dataset !== journal.dataset || manifest.id !== id ||
      created !== Number(id.slice(0, 13)) || created > now.valueOf() + 300000 || (!allowExpired && created < now.valueOf() - BACKUP_RETENTION_DAYS * DAY) ||
      (manifest.verifiedAt !== undefined && (!Number.isFinite(Date.parse(manifest.verifiedAt)) || Date.parse(manifest.verifiedAt) < created || Date.parse(manifest.verifiedAt) > now.valueOf() + 300000)) ||
      !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > MAX_DATABASE_BYTES || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '') ||
      !Array.isArray(manifest.parts) || manifest.parts.length !== Math.ceil(manifest.bytes / PART_SIZE) ||
      !manifest.parts.every((part, index) => part.bytes === Math.min(PART_SIZE, manifest.bytes - index * PART_SIZE) && /^[a-f0-9]{64}$/.test(part.sha256 || ''))) throw recoveryFailure();
  return manifest;
}

export async function restoreDatabaseBackup({ journal, id, outputDirectory, privacyKey, now = () => new Date() }) {
  if (!isAbsolute(outputDirectory)) throw recoveryFailure();
  await journal.verify();
  const manifest = await readBackupManifest(journal, id, now());
  await mkdir(outputDirectory, { mode: 0o700 }); // No recursive flag or overwrite.
  const path = join(outputDirectory, 'commerce.sqlite');
  let db, handle, successful = false;
  try {
    handle = await open(path, 'wx', 0o600);
    const hash = createHash('sha256');
    for (let index = 0; index < manifest.parts.length; index++) {
      const partPath = `backups/${id}/${String(index).padStart(4, '0')}.bin`;
      const chunk = journal.codec.open(partPath, await journal.store.read(partPath, PART_SIZE + 32));
      if (chunk.length !== manifest.parts[index].bytes || sha256(chunk) !== manifest.parts[index].sha256) throw recoveryFailure();
      hash.update(chunk); await handle.writeFile(chunk);
    }
    if (hash.digest('hex') !== manifest.sha256) throw recoveryFailure();
    await handle.sync(); await handle.close(); handle = null;
    inspectDatabase(path);
    // Backups can predate the deployed schema. Apply checked-in migrations to
    // this isolated copy before replaying erasures that cover newer tables.
    const require = createRequire(import.meta.url);
    await promisify(execFile)(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url))], {
      env: { ...process.env, DATABASE_URL: databaseUrl(path) }, windowsHide: true, timeout: 60000, maxBuffer: 65536,
    });
    db = new PrismaClient({ datasources: { db: { url: databaseUrl(path) } } });
    const replay = await journal.replay(db, applyRecoveryEvent);
    await db.$transaction(async tx => {
      // Restored authorizations and old download URLs must never resume silently.
      await tx.session.deleteMany();
      await tx.automationSettings.updateMany({ data: { enabled: false } });
      await tx.automationJob.updateMany({ where: { status: { in: ['pending', 'running', 'retry-wait', 'ready'] } }, data: { status: 'revoked', expiresAt: null, leaseId: null, leaseUntil: null, nextAttemptAt: null } });
      await tx.usageOrder.deleteMany({ where: { completedAt: null } });
    });
    await pruneAutomationJobs(db, now()); await prunePrivacyRequests(db, now()); await pruneUsage(db, now()); await pruneAccessEvents(db, now());
    const privacyService = createPrivacyService({ db, key: privacyKey, now });
    const privacy = await privacyService.status();
    if (privacy.keyMismatch) throw recoveryFailure();
    const verifiedExports = await privacyService.verifyPending();
    await db.$disconnect(); db = null;
    // Remove deleted rows from freelist pages and sidecars before promotion.
    inspectDatabase(path, true);
    const report = { format: 'fullbleed-recovery-ready-v1', dataset: journal.dataset, backupId: id,
      restoredAt: now().toISOString(), replay, sourceSha256: manifest.sha256, restoredSha256: await fileHash(path),
      integrityChecked: true, sessionsCleared: true, automationPaused: true, oldActiveLinksRevoked: true,
      outstandingPrivacyRequests: privacy.pending, authenticatedPrivacySnapshots: verifiedExports.checked };
    await privateJson(join(outputDirectory, 'recovery-ready.json'), report);
    successful = true;
    return report;
  } finally {
    await handle?.close(); await db?.$disconnect();
    if (!successful) {
      for (const suffix of ['', '-wal', '-shm', '-journal']) await unlink(path + suffix).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await unlink(join(outputDirectory, 'recovery-ready.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rmdir(outputDirectory);
    }
  }
}

export async function pruneRecoveryStorage({ journal, db, now = new Date() }) {
  // Apply any intent whose original database commit failed before expiring it.
  await journal.replay(db, applyRecoveryEvent);
  const paths = await journal.store.list('backups/');
  const expired = new Map();
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length !== 3 || !backupIdPattern.test(parts[1]) || !/^(?:\d{4}|manifest)\.bin$/.test(parts[2])) throw recoveryFailure();
    // One extra day lets interrupted uploads finish before removing orphan parts.
    if (Number(parts[1].slice(0, 13)) < now.valueOf() - (BACKUP_RETENTION_DAYS + 1) * DAY) expired.set(parts[1], true);
  }
  let removedObjects = 0;
  for (const path of paths) if (expired.has(path.split('/')[1])) { await journal.store.remove(path); removedObjects++; }
  let removedEvents = 0;
  for (const entry of await journal.entries()) {
    if (Date.parse(entry.recordedAt) >= now.valueOf() - RECOVERY_RETENTION_DAYS * DAY) continue;
    if (!await db.recoveryReceipt.findUnique({ where: { id: entry.id } })) throw recoveryFailure();
    await journal.store.remove(entry.path);
    await db.recoveryReceipt.delete({ where: { id: entry.id } });
    removedEvents++;
  }
  await db.recoveryReceipt.deleteMany({ where: { id: { not: { startsWith: 'dataset:' } }, recordedAt: { lt: new Date(now.valueOf() - RECOVERY_RETENTION_DAYS * DAY) } } });
  return { removedBackupObjects: removedObjects, removedEvents };
}

// A hard-killed worker cannot execute finally. Remove only old private snapshot
// directories owned by this app, never another filename or an active writer.
export async function pruneAbandonedSnapshots(databasePath, now = new Date()) {
  if (!isAbsolute(databasePath)) throw recoveryFailure();
  const root = dirname(databasePath), cutoff = now.valueOf() - DAY;
  const allowed = new Set(['snapshot.sqlite', 'snapshot.sqlite-wal', 'snapshot.sqlite-shm', 'snapshot.sqlite-journal']);
  let removed = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!/^\.fullbleed-backup-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
    const path = join(root, entry.name), directory = await lstat(path);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.mtimeMs >= cutoff) continue;
    if (process.getuid && (directory.uid !== process.getuid() || (directory.mode & 0o077))) throw recoveryFailure();
    const files = await readdir(path);
    if (files.some(name => !allowed.has(name))) throw recoveryFailure();
    const metadata = await Promise.all(files.map(name => lstat(join(path, name))));
    if (metadata.some(item => !item.isFile() || item.isSymbolicLink())) throw recoveryFailure();
    if (metadata.some(item => item.mtimeMs >= cutoff)) continue;
    for (const name of files) await unlink(join(path, name));
    await rmdir(path); removed++;
  }
  return removed;
}
