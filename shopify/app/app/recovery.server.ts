// SPDX-License-Identifier: GPL-2.0-or-later
import { createRecoveryJournal } from '../../recovery-journal.js';
import { recoveryStoreFromEnvironment } from '../scripts/recovery-store.mjs';

let journal: Promise<ReturnType<typeof createRecoveryJournal>> | undefined;
export function recoveryJournal() {
  if (!journal) journal = recoveryStoreFromEnvironment().then(store => createRecoveryJournal({ store,
    key: process.env.FULLBLEED_RECOVERY_KEY, dataset: process.env.FULLBLEED_RECOVERY_DATASET })).catch(error => { journal = undefined; throw error; });
  return journal;
}

export async function recordRecovery(tx: Parameters<Awaited<ReturnType<typeof recoveryJournal>>['record']>[0], event: Parameters<Awaited<ReturnType<typeof recoveryJournal>>['record']>[1]) {
  try { await (await recoveryJournal()).record(tx, event); }
  catch { throw new Response('Privacy recovery storage needs operator review. Please retry.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
