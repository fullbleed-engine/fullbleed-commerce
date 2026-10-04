// SPDX-License-Identifier: MIT
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { createRecoveryJournal, recoveryFailure } from '../../recovery-journal.js';
import { applyRecoveryEvent } from '../../privacy.js';
import { recoveryStoreFromEnvironment } from './recovery-store.mjs';
import { configuredDatabasePath, createDatabaseBackup, restoreDatabaseBackup, pruneRecoveryStorage, readBackupManifest, pruneAbandonedSnapshots } from './recovery-operations.mjs';
import { backupsEnabled, backupStatus, maintainBackups } from './backup-maintenance.mjs';
import { createOperatorAudit, operatorContextFromEnvironment, serviceAuditContext } from '../../operator-audit.js';

process.umask(0o077);
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { backup: { type: 'string' }, output: { type: 'string' }, service: { type: 'boolean' } } });
  const [command] = positionals;
  if (positionals.length !== 1 || !['init','backup','restore','reconcile','prune','list','maintain','status'].includes(command) ||
      (command !== 'restore' && Object.keys(values).some(key => key !== 'service')) || (command === 'restore' && (!values.backup || !values.output)) ||
      (values.service && !['reconcile', 'maintain'].includes(command))) throw recoveryFailure();
  const context = values.service ? serviceAuditContext(`recovery.${command}`) : operatorContextFromEnvironment(`recovery.${command}`);
  const journal = createRecoveryJournal({ store: await recoveryStoreFromEnvironment(), key: process.env.FULLBLEED_RECOVERY_KEY, dataset: process.env.FULLBLEED_RECOVERY_DATASET });
  // Bootstrap only the empty dataset marker; no customer DB is opened by init.
  if (command === 'init') await journal.initialize();
  const { id, result } = await createOperatorAudit({ journal }).run(context, async () => {
    let db, result;
    try {
      if (command === 'init') result = { initialized: true };
      else if (command === 'status') {
        result = await backupStatus({ journal, enabled: backupsEnabled() });
        if (result.status !== 'fresh') process.exitCode = 1;
      } else if (command === 'restore') {
        result = await restoreDatabaseBackup({ journal, id: values.backup, outputDirectory: values.output, privacyKey: process.env.FULLBLEED_PRIVACY_KEY });
      } else if (command === 'list') {
        await journal.verify();
        result = [];
        for (const path of await journal.store.list('backups/')) {
          if (!path.endsWith('/manifest.bin')) continue;
          const manifest = await readBackupManifest(journal, path.split('/')[1], new Date(), true);
          result.push({ id: manifest.id, createdAt: manifest.createdAt, bytes: manifest.bytes, expiresAt: new Date(Date.parse(manifest.createdAt) + 7 * 86400000).toISOString() });
        }
      } else {
        const databasePath = configuredDatabasePath(process.env.DATABASE_URL);
        db = new PrismaClient();
        if (command === 'backup') result = await createDatabaseBackup({ db, databasePath, journal });
        else if (command === 'maintain') result = await maintainBackups({ db, databasePath, journal, enabled: backupsEnabled() });
        else if (command === 'prune') result = { ...await pruneRecoveryStorage({ db, journal }), removedAbandonedSnapshots: await pruneAbandonedSnapshots(databasePath) };
        else result = await journal.replay(db, applyRecoveryEvent);
      }
      return result;
    } finally { await db?.$disconnect(); }
  });
  console.log(JSON.stringify({ operation: command, auditId: id, result }));
} catch {
  // No paths, object keys, provider response bodies, tokens or customer details.
  console.error('Fullbleed recovery failed. Keep the service offline for restoration; check keys, storage, backup age and operator instructions.');
  process.exitCode = 1;
}
