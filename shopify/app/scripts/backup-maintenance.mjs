// SPDX-License-Identifier: MIT
import { recoveryFailure } from '../../recovery-journal.js';
import { createDatabaseBackup, pruneRecoveryStorage, readBackupManifest, pruneAbandonedSnapshots } from './recovery-operations.mjs';

export const BACKUP_INTERVAL_SECONDS = 24 * 3600;
export const BACKUP_MAX_AGE_SECONDS = 26 * 3600;
const backupPath = /^backups\/(\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(\d{4}|manifest)\.bin$/;

export function backupsEnabled(env = process.env) {
  if (!['true', 'false'].includes(env.FULLBLEED_BACKUPS_ENABLED)) throw recoveryFailure();
  return env.FULLBLEED_BACKUPS_ENABLED === 'true';
}

/** Read-only: authenticate the latest manifest and check part presence. Full
 * part authentication runs at creation and restore, not on every HTTP probe.
 * No bucket names, object IDs, keys or merchant information leave this method.
 */
export async function backupStatus({ journal, enabled, now = new Date() }) {
  if (typeof enabled !== 'boolean' || !Number.isFinite(now.valueOf())) throw recoveryFailure();
  await journal.verify();
  if (!enabled) return { status: 'disabled', snapshotAt: null, ageSeconds: null };
  const paths = await journal.store.list('backups/');
  if (paths.length > 100000 || new Set(paths).size !== paths.length || paths.some(path => !backupPath.test(path))) throw recoveryFailure();
  const newest = paths.filter(path => path.endsWith('/manifest.bin')).sort().at(-1);
  if (!newest) return { status: 'missing', snapshotAt: null, ageSeconds: null };
  const id = newest.split('/')[1];
  const manifest = await readBackupManifest(journal, id, now, true);
  const prefix = `backups/${id}/`, objects = new Set(paths.filter(path => path.startsWith(prefix)));
  if (objects.size !== manifest.parts.length + 1 || manifest.parts.some((_, index) => !objects.has(`${prefix}${String(index).padStart(4, '0')}.bin`))) throw recoveryFailure();
  const ageSeconds = Math.max(0, Math.floor((now.valueOf() - Date.parse(manifest.createdAt)) / 1000));
  const status = !manifest.verifiedAt ? 'unverified' : ageSeconds > BACKUP_MAX_AGE_SECONDS ? 'stale' : 'fresh';
  return { status, snapshotAt: manifest.createdAt, ageSeconds };
}

/** One service replica calls this at startup and hourly in a separate process.
 * Storage determines when a backup is due, so restarts cannot reset that clock.
 * A concurrent manual backup can produce another valid snapshot harmlessly.
 */
export async function maintainBackups({ db, databasePath, journal, enabled, now = () => new Date() }) {
  const retention = await pruneRecoveryStorage({ db, journal, now: now() });
  retention.removedAbandonedSnapshots = await pruneAbandonedSnapshots(databasePath, now());
  const status = await backupStatus({ journal, enabled, now: now() });
  if (!enabled || (status.status === 'fresh' && status.ageSeconds < BACKUP_INTERVAL_SECONDS)) {
    return { backupCreated: false, backups: status, retention };
  }
  const backup = await createDatabaseBackup({ db, databasePath, journal, now });
  return { backupCreated: true, backup, backups: await backupStatus({ journal, enabled, now: now() }), retention };
}
