// SPDX-License-Identifier: GPL-2.0-or-later
import db from './db.server';
import { pruneAutomationJobs } from '../../flow.js';
import { prunePrivacyRequests } from '../../privacy.js';
import { pruneUsage } from '../../usage.js';
import { recoveryJournal } from './recovery.server';
import { pruneRecoveryStorage } from '../scripts/recovery-operations.mjs';
import { backupsEnabled } from '../scripts/backup-maintenance.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

declare global {
  // eslint-disable-next-line no-var
  var fullbleedAutomationCleanup: ReturnType<typeof setInterval> | undefined;
}

// A single persistent replica checks at startup and hourly. Independent storage
// preserves the backup clock across replacement. SQLite backup and integrity
// work run outside the HTTP event loop, with no shell or credentials in args.
const execute = promisify(execFile);
if (!global.fullbleedAutomationCleanup) {
  let running = false;
  const clean = async () => {
    if (running) return;
    running = true;
    try {
      await Promise.all([pruneAutomationJobs(db), prunePrivacyRequests(db), pruneUsage(db)]);
      if (backupsEnabled()) {
        await execute(process.execPath, ['scripts/recovery.mjs', 'maintain'], {
          timeout: 10 * 60000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, windowsHide: true,
        });
      } else {
        await pruneRecoveryStorage({ db, journal: await recoveryJournal() });
      }
    } catch { console.error('Fullbleed metadata cleanup or scheduled backup needs operator review and will retry.'); }
    finally { running = false; }
  };
  void clean();
  global.fullbleedAutomationCleanup = setInterval(clean, 3600000);
  global.fullbleedAutomationCleanup.unref();
}
