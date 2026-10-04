// SPDX-License-Identifier: MIT
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';

export const BACKUP_RETENTION_DAYS = 7;
// Keep erasure instructions through the restore window and its cleanup grace.
export const RECOVERY_RETENTION_DAYS = BACKUP_RETENTION_DAYS + 1;
export const BACKUP_REPLAY_BOUNDARY = 'before-replay';
export const recoveryFailure = () => new Error('Recovery storage is unavailable or invalid. Keep recovery offline and investigate.');
const shopPattern = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const eventPath = /^journal\/(\d{13})-([a-f0-9-]{36})\.bin$/;
const MAX_EVENT_BYTES = 8 * 1024 * 1024;

export function recoveryCodec(key, dataset) {
  if (!/^[a-f0-9]{64}$/i.test(key || '') || !uuid.test(dataset || '')) throw recoveryFailure();
  const bytes = createHmac('sha256', Buffer.from(key, 'hex')).update(`fullbleed:recovery:v1:${dataset}`).digest();
  const aad = purpose => Buffer.from(`fullbleed:recovery:v1:${dataset}:${purpose}`);
  return {
    seal(purpose, value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', bytes, iv);
      cipher.setAAD(aad(purpose));
      const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([Buffer.from('FBR1'), iv, cipher.getAuthTag(), encrypted]);
    },
    open(purpose, value) {
      try {
        if (value.length < 32 || value.subarray(0, 4).toString() !== 'FBR1') throw recoveryFailure();
        const cipher = createDecipheriv('aes-256-gcm', bytes, value.subarray(4, 16));
        cipher.setAAD(aad(purpose)); cipher.setAuthTag(value.subarray(16, 32));
        return Buffer.concat([cipher.update(value.subarray(32)), cipher.final()]);
      } catch { throw recoveryFailure(); }
    },
  };
}

export function validateRecoveryEvent(event) {
  if (!event || !shopPattern.test(event.shop || '')) throw recoveryFailure();
  const keys = Object.keys(event).sort().join(',');
  if (event.type === 'erase-shop' && keys === 'shop,type') return;
  if (event.type === 'complete-request' && keys === 'requestId,shop,type' && uuid.test(event.requestId || '')) return;
  if (event.type !== 'erase-customer' || keys !== 'customerKey,emailKey,orderIds,shop,type' ||
      ![event.customerKey, event.emailKey].every(value => value === null || /^[a-f0-9]{64}$/.test(value)) ||
      !Array.isArray(event.orderIds) || event.orderIds.length > 60000 ||
      !event.orderIds.every(value => typeof value === 'string' && /^gid:\/\/shopify\/Order\/[1-9]\d{0,19}$/.test(value))) throw recoveryFailure();
}

/** The durable object is written BEFORE the erasure transaction can commit.
 * A receipt commits with that erasure, so a snapshot cannot confuse an in-flight
 * journal write with an already-applied operation. Failed commits are replayable.
 * store belongs to a different storage resource from the application database.
 */
export function createRecoveryJournal({ store, key, dataset, now = () => new Date() }) {
  const codec = recoveryCodec(key, dataset);
  const encode = (purpose, value) => codec.seal(purpose, Buffer.from(JSON.stringify(value)));
  const decode = (purpose, value) => { try { return JSON.parse(codec.open(purpose, value).toString('utf8')); } catch { throw recoveryFailure(); } };
  async function verify() {
    const marker = decode('dataset', await store.read('dataset.bin', 4096));
    if (marker.format !== 'fullbleed-recovery-v1' || marker.dataset !== dataset || !Number.isFinite(Date.parse(marker.createdAt))) throw recoveryFailure();
    return marker;
  }
  async function initialize() {
    try { await store.write('dataset.bin', encode('dataset', { format: 'fullbleed-recovery-v1', dataset, createdAt: now().toISOString() }), { exclusive: true }); }
    catch (error) { if (error.code !== 'RECOVERY_OBJECT_EXISTS') throw error; }
    return verify();
  }
  async function bound(db) {
    const rows = await db.recoveryReceipt.findMany({ where: { id: { startsWith: 'dataset:' } }, select: { id: true } });
    if (rows.length === 1 && rows[0].id === `dataset:${dataset}`) return true;
    if (rows.length) throw recoveryFailure();
    return false;
  }
  async function identity(tx, marker) {
    if (await bound(tx)) return;
    await tx.recoveryReceipt.create({ data: { id: `dataset:${dataset}`, recordedAt: new Date(marker.createdAt) } });
  }
  async function bind(db) {
    const marker = await verify();
    // Dataset bindings are immutable. Rechecking one needs no SQLite writer
    // lock, which would contend with concurrent cleanup or erasure. First bind
    // still checks again inside the transaction before creating the marker.
    if (await bound(db)) return;
    await db.$transaction(tx => identity(tx, marker));
  }
  async function record(tx, event) {
    validateRecoveryEvent(event);
    await identity(tx, await verify());
    const id = randomUUID(), recordedAt = now();
    const path = `journal/${String(recordedAt.valueOf()).padStart(13, '0')}-${id}.bin`;
    const body = encode(path, { id, recordedAt: recordedAt.toISOString(), event });
    if (body.length > MAX_EVENT_BYTES) throw recoveryFailure();
    await store.write(path, body, { exclusive: true });
    await tx.recoveryReceipt.create({ data: { id, recordedAt } });
  }
  async function entries() {
    await verify();
    const paths = await store.list('journal/');
    if (paths.length > 100000 || new Set(paths).size !== paths.length) throw recoveryFailure();
    const result = [];
    let bytes = 0;
    for (const path of paths.sort()) {
      const match = eventPath.exec(path);
      if (!match || !uuid.test(match[2])) throw recoveryFailure();
      const body = await store.read(path, MAX_EVENT_BYTES);
      bytes += body.length;
      if (bytes > 64 * 1024 * 1024) throw recoveryFailure();
      const entry = decode(path, body);
      if (entry.id !== match[2] || Date.parse(entry.recordedAt) !== Number(match[1]) || Date.parse(entry.recordedAt) > now().valueOf() + 300000) throw recoveryFailure();
      validateRecoveryEvent(entry.event);
      result.push({ ...entry, path });
    }
    return result;
  }
  async function replay(db, apply) {
    await bind(db);
    // Read and authenticate every object before mutating the recovery database.
    const records = await entries();
    let applied = 0;
    for (const entry of records) {
      // A committed receipt is immutable until retention removes its journal
      // object. Already-applied entries need no writer lock. Missing receipts
      // are checked again with the erasure inside the transaction below.
      if (await db.recoveryReceipt.findUnique({ where: { id: entry.id } })) continue;
      await db.$transaction(async tx => {
        if (await tx.recoveryReceipt.findUnique({ where: { id: entry.id } })) return;
        await apply(tx, entry.event, new Date(entry.recordedAt));
        await tx.recoveryReceipt.create({ data: { id: entry.id, recordedAt: new Date(entry.recordedAt) } });
        applied++;
      }, { maxWait: 1000, timeout: 10000 });
    }
    return { checked: records.length, applied };
  }
  return { initialize, verify, bind, record, entries, replay, codec, store, dataset };
}
