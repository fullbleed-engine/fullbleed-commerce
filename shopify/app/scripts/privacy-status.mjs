// SPDX-License-Identifier: MIT
// Aggregate-only monitoring. Supply the deployed database/key through the environment.
import { PrismaClient } from '@prisma/client';
import { createPrivacyService } from '../../privacy.js';
if (!process.env.DATABASE_URL) throw new Error('Set the deployed DATABASE_URL explicitly.');
const db = new PrismaClient();
try {
  const result = await createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY }).status();
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }));
  process.exitCode = result.keyMismatch ? 2 : result.dueWithin48Hours ? 1 : 0;
} catch {
  console.error('Fullbleed privacy monitoring unavailable. Check database and key configuration.');
  process.exitCode = 2;
} finally { await db.$disconnect(); }
