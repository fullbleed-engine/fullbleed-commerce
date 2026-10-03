// SPDX-License-Identifier: MIT
// Never run this against a merchant database. Used only by the isolated runner.
import { PrismaClient } from '@prisma/client';
if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret' || process.env.FULLBLEED_RECOVERY_KEY !== 'ef'.repeat(32) || !process.env.FULLBLEED_RECOVERY_DIRECTORY) throw new Error('Use the isolated test runner.');
const db = new PrismaClient();
try { await db.recoveryReceipt.deleteMany(); }
finally { await db.$disconnect(); }
