// SPDX-License-Identifier: MIT
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { createRecoveryJournal, recoveryFailure } from '../../recovery-journal.js';
import { applyRecoveryEvent } from '../../privacy.js';
import { recoveryStoreFromEnvironment } from './recovery-store.mjs';
import { configuredDatabasePath, createDatabaseBackup, restoreDatabaseBackup, pruneRecoveryStorage, readBackupManifest } from './recovery-operations.mjs';

process.umask(0o077);
let db;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { backup: { type: 'string' }, output: { type: 'string' } } });
  const [command] = positionals;
  if (positionals.length !== 1 || !['init','backup','restore','reconcile','prune','list'].includes(command) ||
      (command !== 'restore' && Object.keys(values).length) || (command === 'restore' && (!values.backup || !values.output))) throw recoveryFailure();
  const journal = createRecoveryJournal({ store: await recoveryStoreFromEnvironment(), key: process.env.FULLBLEED_RECOVERY_KEY, dataset: process.env.FULLBLEED_RECOVERY_DATASET });
  let result;
  if (command === 'init') {
    await journal.initialize(); result = { initialized: true };
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
    else if (command === 'prune') result = await pruneRecoveryStorage({ db, journal });
    else result = await journal.replay(db, applyRecoveryEvent);
  }
  console.log(JSON.stringify({ operation: command, result }));
} catch {
  // No paths, object keys, provider response bodies, tokens or customer details.
  console.error('Fullbleed recovery failed. Keep the service offline for restoration; check keys, storage, backup age and operator instructions.');
  process.exitCode = 1;
} finally { await db?.$disconnect(); }
