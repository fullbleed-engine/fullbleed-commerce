// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';

export const OPERATOR_AUDIT_RETENTION_DAYS = 30;
const DAY = 86400000, MAX_BYTES = 4096, MAX_OBJECTS = 10000;
const identifier = /^\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const purposes = new Set(['maintenance', 'recovery', 'privacy', 'support', 'security']);
const operations = new Set(['init', 'backup', 'restore', 'reconcile', 'prune', 'list', 'maintain', 'status'].map(value => `recovery.${value}`)
  .concat(['privacy.status', 'console.railway', 'console.shopify', 'console.github', 'audit.review', 'audit.prune']));
const outcomes = new Set(['completed', 'failed', 'cancelled']);
export const operatorAuditFailure = () => new Error('Operator audit is unavailable or invalid. Do not continue unrecorded access.');

function validateContext(context) {
  const fields = Object.keys(context || {}).sort().join(',');
  if (!context || !['operation,operator,purpose,reference', 'identitySource,operation,operator,purpose,reference'].includes(fields) ||
      !/^[a-z][a-z0-9._-]{1,63}$/.test(context.operator || '') || !purposes.has(context.purpose) || !operations.has(context.operation) ||
      !/^(?:OPS|INC|PRIV)-\d{8}-[A-Z0-9]{3,12}$/.test(context.reference || '')) throw operatorAuditFailure();
  const source = context.identitySource ?? 'operator-environment';
  if (!['operator-environment', 'service-process'].includes(source) ||
      (source === 'operator-environment' && context.operator === 'fullbleed-maintenance') ||
      (source === 'service-process' && (context.operator !== 'fullbleed-maintenance' || context.purpose !== 'maintenance' ||
        !['recovery.reconcile', 'recovery.maintain'].includes(context.operation) || !/^OPS-\d{8}-AUTO$/.test(context.reference)))) throw operatorAuditFailure();
  return source;
}

export function operatorContextFromEnvironment(operation, env = process.env) {
  const context = { operator: env.FULLBLEED_OPERATOR_ID, reference: env.FULLBLEED_OPERATOR_REFERENCE,
    purpose: env.FULLBLEED_OPERATOR_PURPOSE, operation };
  validateContext(context);
  return context;
}

export function serviceAuditContext(operation, now = new Date()) {
  const context = { operator: 'fullbleed-maintenance', purpose: 'maintenance', operation,
    reference: `OPS-${now.toISOString().slice(0, 10).replaceAll('-', '')}-AUTO`, identitySource: 'service-process' };
  validateContext(context);
  return context;
}

/** Encrypted, create-only receipts in recovery storage, outside the live DB.
 * This records the configured operator identity, not an independent login.
 * A holder of storage/key credentials can delete or forge records: not WORM.
 */
export function createOperatorAudit({ journal, now = () => new Date() }) {
  function validate(record, id, phase) {
    const fields = 'dataset,format,id,identitySource,operation,operator,phase,purpose,recordedAt,reference,startedAt';
    const expected = (fields + (phase === 'finished' ? ',outcome' : '')).split(',').sort().join(',');
    if (!record || Object.keys(record).sort().join(',') !== expected || record.format !== 'fullbleed-operator-audit-v1' ||
        record.dataset !== journal.dataset || record.id !== id || !identifier.test(id) || record.phase !== phase ||
        Date.parse(record.startedAt) !== Number(id.slice(0, 13)) ||
        new Date(Number(id.slice(0, 13))).toISOString() !== record.startedAt ||
        !Number.isFinite(Date.parse(record.recordedAt)) || new Date(record.recordedAt).toISOString() !== record.recordedAt ||
        Date.parse(record.recordedAt) > now().valueOf() + 300000 || Date.parse(record.recordedAt) < Date.parse(record.startedAt) ||
        (phase === 'started' && record.recordedAt !== record.startedAt) ||
        (phase === 'finished' && (!outcomes.has(record.outcome) || Date.parse(record.recordedAt) - Date.parse(record.startedAt) > DAY))) throw operatorAuditFailure();
    validateContext({ operator: record.operator, reference: record.reference, purpose: record.purpose, operation: record.operation, identitySource: record.identitySource });
    return record;
  }
  async function read(id, phase) {
    if (!identifier.test(id || '')) throw operatorAuditFailure();
    const path = `operator/${id}/${phase}.bin`;
    try {
      const bytes = await journal.store.read(path, MAX_BYTES);
      return validate(JSON.parse(journal.codec.open(path, bytes).toString('utf8')), id, phase);
    } catch { throw operatorAuditFailure(); }
  }
  async function write(record) {
    const path = `operator/${record.id}/${record.phase}.bin`;
    const bytes = journal.codec.seal(path, Buffer.from(JSON.stringify(record)));
    if (bytes.length > MAX_BYTES) throw operatorAuditFailure();
    await journal.store.write(path, bytes, { exclusive: true });
    // Acknowledgement alone is insufficient: authenticate the stored receipt.
    if (JSON.stringify(await read(record.id, record.phase)) !== JSON.stringify(record)) throw operatorAuditFailure();
  }
  async function start(context) {
    const source = validateContext(context);
    await journal.verify();
    const at = now(), id = `${at.valueOf()}-${randomUUID()}`;
    const record = { format: 'fullbleed-operator-audit-v1', dataset: journal.dataset, id, phase: 'started',
      startedAt: at.toISOString(), recordedAt: at.toISOString(), ...context, identitySource: source };
    validate(record, id, 'started');
    await write(record);
    return id;
  }
  async function finish(id, outcome, operator) {
    if (!outcomes.has(outcome)) throw operatorAuditFailure();
    await journal.verify();
    const started = await read(id, 'started'), at = now();
    // Console sessions must close within a day. This also keeps legitimate
    // completion writes far outside the 30-day retention deletion window.
    if (operator !== started.operator || at.valueOf() - Date.parse(started.startedAt) > DAY) throw operatorAuditFailure();
    const finished = { ...started, phase: 'finished', recordedAt: at.toISOString(), outcome };
    validate(finished, id, 'finished');
    try { await write(finished); }
    catch (error) {
      if (error.code !== 'RECOVERY_OBJECT_EXISTS') throw error;
      // A retry may follow a lost acknowledgement. Never overwrite a receipt
      // or change an already-recorded outcome.
      const existing = await read(id, 'finished');
      if (existing.operator !== operator || existing.outcome !== outcome ||
          !['startedAt', 'operation', 'purpose', 'reference'].every(field => existing[field] === started[field])) throw operatorAuditFailure();
      return existing;
    }
    return finished;
  }
  async function entries(include = () => true) {
    await journal.verify();
    const paths = await journal.store.list('operator/');
    if (paths.length > MAX_OBJECTS || new Set(paths).size !== paths.length) throw operatorAuditFailure();
    const selected = [];
    for (const path of paths.sort()) {
      const parts = path.split('/');
      if (parts.length !== 3 || parts[0] !== 'operator' || !identifier.test(parts[1]) || !['started.bin', 'finished.bin'].includes(parts[2])) throw operatorAuditFailure();
      if (include(parts[1])) selected.push({ id: parts[1], phase: parts[2].slice(0, -4) });
    }
    // Bound provider requests during a full review. Retention reads only old
    // receipts, avoiding repeated downloads of a month's scheduled operations.
    let next = 0;
    const results = new Array(selected.length);
    const workers = await Promise.allSettled(Array.from({ length: Math.min(8, selected.length) }, async () => {
      while (next < selected.length) {
        const index = next++, item = selected[index];
        results[index] = { ...item, record: await read(item.id, item.phase) };
      }
    }));
    if (workers.some(worker => worker.status === 'rejected')) throw operatorAuditFailure();
    const records = new Map();
    for (const { id, phase, record } of results) {
      const entry = records.get(id) || { id };
      entry[phase] = record; records.set(id, entry);
    }
    for (const entry of records.values()) {
      if (!entry.started || (entry.finished && !['startedAt', 'operation', 'operator', 'purpose', 'reference'].every(field => entry.started[field] === entry.finished[field]))) throw operatorAuditFailure();
    }
    return [...records.values()].map(entry => ({ ...entry, outcome: entry.finished?.outcome || 'incomplete' }));
  }
  async function run(context, task) {
    const id = await start(context);
    let result;
    try { result = await task(id); }
    catch (error) { await finish(id, 'failed', context.operator); throw error; }
    await finish(id, 'completed', context.operator);
    return { id, result };
  }
  async function prune() {
    // Authenticate all expired records before deleting any. End first leaves a valid
    // incomplete start if storage fails during retention cleanup.
    const cutoff = now().valueOf() - OPERATOR_AUDIT_RETENTION_DAYS * DAY;
    const records = await entries(id => Number(id.slice(0, 13)) < cutoff);
    let removed = 0;
    for (const entry of records) {
      if (Date.parse(entry.started.startedAt) >= cutoff) continue;
      if (entry.finished) await journal.store.remove(`operator/${entry.id}/finished.bin`);
      await journal.store.remove(`operator/${entry.id}/started.bin`); removed++;
    }
    return { removed };
  }
  return { start, finish, entries, run, prune };
}
