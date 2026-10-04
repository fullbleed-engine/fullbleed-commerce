// SPDX-License-Identifier: MIT
export const accessHeaders = Object.freeze({ 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
export const accessOperations = Object.freeze({
  'orders.list': 'Recent orders opened',
  'templates.list': 'Template studio opened',
  'document.render': 'Order PDF request',
  'template.preview': 'Template preview request',
  'automation.list': 'Automation activity opened',
  'flow.prepare': 'Flow document preparation',
  'document.download': 'Private-link PDF request',
  'privacy.list': 'Privacy requests opened',
  'privacy.export': 'Privacy export request',
  'privacy.capture': 'Privacy request capture',
  'access.list': 'Access history opened',
});
const DAY = 86400000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const fail = (message = 'Access history is temporarily unavailable. Try again later.', status = 503) => new Response(message, { status, headers: accessHeaders });

/** The caller must supply the payload returned by Shopify's authenticator. */
export function staffActor(sessionToken) {
  if (typeof sessionToken?.sub !== 'string' || !/^[1-9]\d{0,19}$/.test(sessionToken.sub)) throw fail('Reopen Fullbleed in Shopify to verify your staff session.', 401);
  return { type: 'staff', id: sessionToken.sub };
}

/**
 * @typedef {{shop: string, actor: {type: string, id: string}, operation: string,
 * orderId?: string, requestId?: string, jobId?: string}} AccessInput
 */
function validated(input) {
  const { shop, actor, operation, orderId = null, requestId = null, jobId = null } = input;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !Object.hasOwn(accessOperations, operation)) throw fail();
  const expected = operation === 'flow.prepare' ? 'flow' : operation === 'document.download' ? 'document_link' : operation === 'privacy.capture' ? 'shopify_privacy' : 'staff';
  if (actor?.type !== expected || typeof actor.id !== 'string') throw fail();
  if (expected === 'staff' && !/^[1-9]\d{0,19}$/.test(actor.id)) throw fail();
  if (expected === 'flow' && !/^[A-Za-z0-9_-]{1,128}$/.test(actor.id)) throw fail();
  if (expected === 'document_link' && (!uuid(actor.id) || actor.id !== jobId)) throw fail();
  if (expected === 'shopify_privacy' && actor.id !== 'shopify') throw fail();
  if (orderId !== null && (typeof orderId !== 'string' || !/^gid:\/\/shopify\/Order\/[1-9]\d{0,19}$/.test(orderId))) throw fail();
  if (requestId !== null && !uuid(requestId) || jobId !== null && !uuid(jobId)) throw fail();
  if (['document.render', 'template.preview', 'flow.prepare', 'document.download'].includes(operation) && !orderId) throw fail();
  if (['flow.prepare', 'document.download'].includes(operation) && !jobId || operation === 'privacy.export' && !requestId) throw fail();
  // Deliberately copy only these fields. Never serialize a request, token,
  // document, address, template, exception, IP address or client-provided label.
  return { shop, actorType: expected, actorId: actor.id, operation, orderId, requestId, jobId };
}

export async function pruneAccessEvents(db, now = new Date()) {
  return db.accessEvent.deleteMany({ where: { startedAt: { lt: new Date(now.valueOf() - 30 * DAY) } } });
}

export function createAccessAudit({ db, now = () => new Date() }) {
  async function transaction(work) {
    try { return await db.$transaction(work); }
    catch (error) { if (error instanceof Response) throw error; throw fail(); }
  }
  async function finish(ticket, status) {
    await transaction(async tx => {
      const updated = await tx.accessEvent.updateMany({ where: { id: ticket.id, shop: ticket.shop, outcome: 'started' }, data: {
        outcome: status < 400 ? 'completed' : status < 500 ? 'denied' : 'failed',
        finishedAt: now(),
      } });
      // Erasure/uninstall may remove an in-flight entry. Never recreate it or
      // release the response after that deletion has won the race.
      if (!updated.count) throw fail('This data request was cleared. Reload the app before trying again.', 410);
    });
  }
  /** @template T @param {AccessInput} input @param {(ticket: {id: string, shop: string}) => Promise<T>} work @returns {Promise<T>} */
  async function run(input, work) {
    const data = validated(input);
    const ticket = await transaction(async tx => {
      if (!await tx.session.findUnique({ where: { id: `offline_${data.shop}` }, select: { id: true } })) throw fail('The installation must be checked before requesting data.', data.actorType === 'shopify_privacy' ? 503 : 401);
      if (data.requestId && !await tx.privacyRequest.findFirst({ where: { shop: data.shop, id: data.requestId }, select: { id: true } })) throw fail('Privacy request not found.', 404);
      if (data.jobId && !await tx.automationJob.findFirst({ where: { shop: data.shop, id: data.jobId, orderId: data.orderId }, select: { id: true } })) throw fail('Document job not found.', 404);
      return tx.accessEvent.create({ data: { ...data, startedAt: now() }, select: { id: true, shop: true } });
    });
    let result;
    try { result = await work(ticket); }
    catch (error) {
      await finish(ticket, error instanceof Response ? error.status : 500);
      throw error;
    }
    await finish(ticket, result instanceof Response ? result.status : 200);
    return result;
  }
  /**
   * @param {string} shop @param {string | null} cursor @param {string | null} omitId
   * @returns {Promise<{events: {id: string, actorType: string, actorId: string, operation: string,
   * orderId: string | null, requestId: string | null, jobId: string | null, outcome: string,
   * startedAt: Date, finishedAt: Date | null}[], next: string | null}>}
   */
  async function list(shop, cursor = null, omitId = null) {
    const where = { shop, startedAt: { gte: new Date(now().valueOf() - 30 * DAY) }, ...(omitId ? { id: { not: omitId } } : {}) };
    if (cursor && (!uuid(cursor) || !await db.accessEvent.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw fail('Refresh access history.', 400);
    const rows = await db.accessEvent.findMany({ where, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, actorType: true, actorId: true, operation: true, orderId: true, requestId: true, jobId: true, outcome: true, startedAt: true, finishedAt: true },
    });
    return { events: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null };
  }
  return { run, list };
}
