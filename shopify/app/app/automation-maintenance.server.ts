// SPDX-License-Identifier: GPL-2.0-or-later
import db from './db.server';
import { pruneAutomationJobs } from '../../flow.js';
import { prunePrivacyRequests } from '../../privacy.js';

declare global {
  // eslint-disable-next-line no-var
  var fullbleedAutomationCleanup: ReturnType<typeof setInterval> | undefined;
}

// The persistent app process removes 30-day-old metadata at startup and hourly.
// No customer content is logged. Outages defer cleanup until the next attempt.
if (!global.fullbleedAutomationCleanup) {
  const clean = () => Promise.all([pruneAutomationJobs(db), prunePrivacyRequests(db)]).catch(() => console.error('Fullbleed metadata cleanup will retry.'));
  void clean();
  global.fullbleedAutomationCleanup = setInterval(clean, 3600000);
  global.fullbleedAutomationCleanup.unref();
}
