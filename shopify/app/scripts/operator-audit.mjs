// SPDX-License-Identifier: MIT
import { parseArgs } from 'node:util';
import { createRecoveryJournal } from '../../recovery-journal.js';
import { createOperatorAudit, operatorContextFromEnvironment, operatorAuditFailure } from '../../operator-audit.js';
import { recoveryStoreFromEnvironment } from './recovery-store.mjs';

process.umask(0o077);
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    surface: { type: 'string' }, id: { type: 'string' }, outcome: { type: 'string' },
  } });
  const [command] = positionals;
  if (positionals.length !== 1 || !['begin', 'finish', 'review', 'prune'].includes(command)) throw operatorAuditFailure();
  const keys = Object.keys(values).sort().join(',');
  if ((command === 'begin' && (keys !== 'surface' || !['railway', 'shopify', 'github'].includes(values.surface))) ||
      (command === 'finish' && keys !== 'id,outcome') || (['review', 'prune'].includes(command) && keys)) throw operatorAuditFailure();
  const operation = command === 'begin' ? `console.${values.surface}` : 'audit.review';
  const context = operatorContextFromEnvironment(command === 'prune' ? 'audit.prune' : operation);
  const journal = createRecoveryJournal({ store: await recoveryStoreFromEnvironment(), key: process.env.FULLBLEED_RECOVERY_KEY, dataset: process.env.FULLBLEED_RECOVERY_DATASET });
  const audit = createOperatorAudit({ journal });
  if (command === 'begin') console.log(JSON.stringify({ auditId: await audit.start(context), outcome: 'incomplete' }));
  else if (command === 'finish') {
    const result = await audit.finish(values.id, values.outcome, context.operator);
    console.log(JSON.stringify({ auditId: result.id, outcome: result.outcome }));
  } else {
    const { id, result } = await audit.run(context, async ownId => {
      if (command === 'prune') return audit.prune();
      const entries = (await audit.entries()).filter(entry => entry.id !== ownId);
      return { checkedAt: new Date().toISOString(), incomplete: entries.filter(entry => entry.outcome === 'incomplete').length, entries };
    });
    console.log(JSON.stringify({ auditId: id, result }));
    if (command === 'review' && result.incomplete) process.exitCode = 1;
  }
} catch {
  console.error('Fullbleed operator audit failed. Do not continue unrecorded access; check the operator context and independent storage, then review incomplete sessions.');
  process.exitCode = 2;
}
