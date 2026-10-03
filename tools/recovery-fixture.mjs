// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRecoveryJournal } from '../shopify/recovery-journal.js';
import { fileRecoveryStore } from '../shopify/app/scripts/recovery-store.mjs';

export async function recoveryFixtureEnvironment(root, label) {
  if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid synthetic fixture label.');
  const target = resolve(root, 'target');
  mkdirSync(target, { recursive: true });
  const directory = mkdtempSync(resolve(target, `${label}-recovery-`));
  const key = 'ef'.repeat(32), dataset = randomUUID();
  await createRecoveryJournal({ store: await fileRecoveryStore(directory), key, dataset }).initialize();
  return { FULLBLEED_BACKUPS_ENABLED: 'false', FULLBLEED_RECOVERY_DIRECTORY: directory, FULLBLEED_RECOVERY_KEY: key,
    FULLBLEED_RECOVERY_DATASET: dataset, FULLBLEED_RECOVERY_ENDPOINT: '',
    FULLBLEED_RECOVERY_ACCESS_KEY_ID: '', FULLBLEED_RECOVERY_SECRET_ACCESS_KEY: '', RAILWAY_ENVIRONMENT_ID: '' };
}
