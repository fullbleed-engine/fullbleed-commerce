// SPDX-License-Identifier: GPL-2.0-or-later
import db from './db.server';
import { pruneAutomationJobs } from '../../flow.js';
import { prunePrivacyRequests } from '../../privacy.js';
import { recoveryJournal } from './recovery.server';
import { pruneRecoveryStorage } from '../scripts/recovery-operations.mjs';

declare global {
  // eslint-disable-next-line no-var
  var fullbleedAutomationCleanup: ReturnType<typeof setInterval> | undefined;
}

// The persistent app process removes 30-day-old metadata at startup and hourly.
// No customer content is logged. Outages defer cleanup until the next attempt.
if (!global.fullbleedAutomationCleanup) {
  let running = false;
  const clean = async () => {
    if (running) return;
    running = true;
    try {
      await Promise.all([pruneAutomationJobs(db), prunePrivacyRequests(db)]);
      await pruneRecoveryStorage({ db, journal: await recoveryJournal() });
    } catch { console.error('Fullbleed metadata and recovery cleanup needs operator review and will retry.'); }
    finally { running = false; }
  };
  void clean();
  global.fullbleedAutomationCleanup = setInterval(clean, 3600000);
  global.fullbleedAutomationCleanup.unref();
}
