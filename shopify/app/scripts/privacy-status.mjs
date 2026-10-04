// SPDX-License-Identifier: MIT
// Aggregate-only monitoring. Supply the deployed database/key through the environment.
import { PrismaClient } from '@prisma/client';
import { createPrivacyService } from '../../privacy.js';
import { createRecoveryJournal } from '../../recovery-journal.js';
import { createOperatorAudit, operatorContextFromEnvironment } from '../../operator-audit.js';
import { recoveryStoreFromEnvironment } from './recovery-store.mjs';
try {
  if (!process.env.DATABASE_URL) throw new Error('Database configuration required.');
  const context = operatorContextFromEnvironment('privacy.status');
  const journal = createRecoveryJournal({ store: await recoveryStoreFromEnvironment(), key: process.env.FULLBLEED_RECOVERY_KEY, dataset: process.env.FULLBLEED_RECOVERY_DATASET });
  const { id, result } = await createOperatorAudit({ journal }).run(context, async () => {
    const db = new PrismaClient();
    try {
      await journal.bind(db);
      return await createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY }).status();
    } finally { await db.$disconnect(); }
  });
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), auditId: id, ...result }));
  process.exitCode = result.keyMismatch ? 2 : result.dueWithin48Hours ? 1 : 0;
} catch {
  console.error('Fullbleed privacy monitoring unavailable. Check operator context, audit storage, database and key configuration.');
  process.exitCode = 2;
}
