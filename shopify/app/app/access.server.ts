// SPDX-License-Identifier: GPL-2.0-or-later
import db from './db.server';
import { createAccessAudit, staffActor } from '../../access-audit.js';

export const accessAudit = createAccessAudit({ db });
type StaffContext = { session: { shop: string }; sessionToken?: { sub: string } };
type References = { orderId?: string; requestId?: string; jobId?: string };
export function staffAccess<T>(context: StaffContext, operation: string, work: (ticket: { id: string; shop: string }) => Promise<T>, references: References = {}) {
  return accessAudit.run({ shop: context.session.shop, actor: staffActor(context.sessionToken), operation, ...references }, work);
}
