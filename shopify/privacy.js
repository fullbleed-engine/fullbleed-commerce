// SPDX-License-Identifier: MIT
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from 'node:crypto';

export const privacyHeaders = Object.freeze({ 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
const fail = (message, status = 400) => new Response(message, { status, headers: privacyHeaders });
const DAY = 24 * 3600000;
const chunked = values => Array.from({ length: Math.ceil(values.length / 250) }, (_, i) => values.slice(i * 250, (i + 1) * 250));
const id = value => {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) throw fail('Invalid privacy request identifier.');
  return value;
};

// Authenticate these exact bytes with Shopify's SDK before interpreting them.
export async function readPrivacyWebhook(request) {
  if (request.method !== 'POST') throw fail('Use POST.', 405);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw fail('Send JSON.', 415);
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (!reader) throw fail('A privacy request is required.');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw fail('Privacy request too large.', 413); }
      chunks.push(value);
    }
  } finally { reader?.releaseLock(); }
  const body = Buffer.concat(chunks);
  return { body, request: new Request(request.url, { method: 'POST', headers: request.headers, body, signal: request.signal }) };
}

export function parsePrivacyPayload(body, shop, topic) {
  let payload;
  try {
    // Node 22.12+ reviver context preserves Shopify IDs beyond JS's safe integer range.
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body), (_key, value, context) =>
      typeof value === 'number' && /^[1-9]\d*$/.test(context.source) ? context.source : value);
  } catch { throw fail('Invalid privacy request JSON.'); }
  if (!payload || payload.shop_domain !== shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw fail('Privacy request does not belong to this store.', 403);
  id(payload.shop_id);
  if (topic === 'SHOP_REDACT') return { shop };
  if (!['CUSTOMERS_DATA_REQUEST', 'CUSTOMERS_REDACT'].includes(topic)) throw fail('Unknown privacy topic.', 404);
  const customerId = payload.customer?.id == null ? null : id(payload.customer.id);
  const email = payload.customer?.email;
  if (email != null && (typeof email !== 'string' || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email))) throw fail('Invalid customer identifier.');
  if (!customerId && !email) throw fail('A customer identifier is required.');
  const orders = payload[topic === 'CUSTOMERS_DATA_REQUEST' ? 'orders_requested' : 'orders_to_redact'];
  if (!Array.isArray(orders) || orders.length > 10000) throw fail('Invalid requested orders.');
  return {
    shop, customerId, email: email || null,
    orderIds: [...new Set(orders.map(value => `gid://shopify/Order/${id(value)}`))].sort(),
    requestId: topic === 'CUSTOMERS_DATA_REQUEST' ? id(payload.data_request?.id) : null,
  };
}

export async function erasePrivacyShop(tx, shop, recordRecovery = async (_tx, _event) => {}) {
  await recordRecovery(tx, { type: 'erase-shop', shop });
  await tx.accessEvent.deleteMany({ where: { shop } });
  await tx.privacyRequest.deleteMany({ where: { shop } });
  await tx.session.deleteMany({ where: { shop } });
  await tx.brand.deleteMany({ where: { shop } });
  await tx.documentTemplate.deleteMany({ where: { shop } });
  await tx.automationSettings.deleteMany({ where: { shop } });
  await tx.usagePeriod.deleteMany({ where: { shop } });
}

export async function prunePrivacyRequests(db, now = new Date()) {
  // Never silently destroy an outstanding export at its response deadline.
  return db.privacyRequest.deleteMany({ where: { finishedAt: { lt: new Date(now.valueOf() - 30 * DAY) }, status: { in: ['completed', 'redacted'] } } });
}

export function createPrivacyService({ db, key, now = () => new Date(), recordRecovery = async (_tx, _event) => {} }) {
  if (typeof key !== 'string' || !/^[a-fA-F0-9]{64}$/.test(key)) throw fail('Privacy exports are temporarily unavailable. Contact Fullbleed support.', 503);
  const derive = purpose => createHmac('sha256', Buffer.from(key, 'hex')).update(`fullbleed:privacy:v1:${purpose}`).digest();
  const encryptionKey = derive('encryption');
  const keyId = createHash('sha256').update(derive('key-identity')).digest('hex');
  const identity = (purpose, shop, value) => value ? createHmac('sha256', derive(purpose)).update(JSON.stringify([shop, value])).digest('hex') : null;
  const keys = input => ({ customerKey: identity('customer', input.shop, input.customerId), emailKey: identity('email', input.shop, input.email?.trim().toLowerCase()) });
  const aad = (shop, requestId) => Buffer.from(JSON.stringify(['fullbleed-privacy-v1', shop, requestId]));
  function encrypt(shop, requestId, content) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(aad(shop, requestId));
    const bytes = Buffer.from(JSON.stringify(content));
    if (bytes.length > 16 * 1024 * 1024) throw fail('Privacy export needs operator assistance.', 503);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }
  function decrypt(row) {
    try {
      const [version, iv, tag, content] = row.snapshot.split('.');
      if (version !== 'v1') throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
      cipher.setAAD(aad(row.shop, row.requestId));
      cipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(content, 'base64url')), cipher.final()]).toString('utf8'));
    } catch { throw fail('Privacy export needs operator assistance.', 503); }
  }
  const transaction = action => db.$transaction(action, { maxWait: 1000, timeout: 4000 });
  async function checkKey(tx, shop) {
    if (await tx.privacyRequest.count({ where: { shop, status: 'ready', OR: [{ keyId: null }, { keyId: { not: keyId } }] } })) throw fail('Privacy key needs operator review.', 503);
  }

  async function accept(input) {
    return transaction(async tx => {
      await checkKey(tx, input.shop);
      const existing = await tx.privacyRequest.findUnique({ where: { shop_requestId: { shop: input.shop, requestId: input.requestId } } });
      if (existing) return existing.id;
      // Delayed delivery must not recreate personal data after uninstall.
      // Shopify retries this failure; operators must investigate undelivered requests.
      if (!await tx.session.findUnique({ where: { id: `offline_${input.shop}` } })) throw fail('Privacy request needs installation review.', 503);
      const receivedAt = now();
      const jobs = [];
      const usage = [];
      const access = [];
      for (const batch of chunked(input.orderIds)) {
        const rows = await tx.automationJob.findMany({ where: { shop: input.shop, orderId: { in: batch } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50001 - jobs.length,
          // Credentials and transient worker leases are not customer export data.
          select: { id: true, runId: true, orderId: true, kind: true, handle: true, status: true, ttlHours: true, retryDeadline: true, attempts: true, nextAttemptAt: true, fingerprint: true, requestHash: true, templateRevision: true, pdfSha256: true, expiresAt: true, lastError: true, downloads: true, lastDownloadedAt: true, createdAt: true, updatedAt: true },
        });
        jobs.push(...rows);
        if (jobs.length > 50000) throw fail('Privacy export needs operator assistance.', 503);
        usage.push(...await tx.usageOrder.findMany({ where: { shop: input.shop, orderId: { in: batch } }, orderBy: [{ orderId: 'asc' }, { id: 'asc' }], take: 50001 - usage.length,
          select: { orderId: true, completedAt: true, period: { select: { startsAt: true, endsAt: true } } },
        }));
        if (usage.length > 50000) throw fail('Privacy export needs operator assistance.', 503);
        access.push(...await tx.accessEvent.findMany({ where: { shop: input.shop, orderId: { in: batch } }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], take: 50001 - access.length,
          // Customer exports describe access to the requested order; staff IDs
          // remain in the authenticated merchant history, not customer exports.
          select: { id: true, orderId: true, operation: true, actorType: true, outcome: true, startedAt: true, finishedAt: true },
        }));
        if (access.length > 50000) throw fail('Privacy export needs operator assistance.', 503);
      }
      const report = {
        format: 'fullbleed-customer-data-v1', shop: input.shop, requestId: input.requestId, capturedAt: receivedAt.toISOString(),
        customer: { ...(input.customerId ? { id: input.customerId } : {}), ...(input.email ? { email: input.email } : {}) },
        requestedOrderIds: input.orderIds, automationJobs: jobs, orderUsage: usage, orderAccess: access,
        scope: 'Retained Fullbleed automation, order-allowance and order-specific access metadata at receipt of this request, plus the identifiers needed to fulfill it. Staff identifiers are omitted. Order contents, addresses, payment details and generated PDFs are not stored. Expired history cannot be reconstructed. No new order data was fetched from Shopify.',
      };
      const row = await tx.privacyRequest.create({ data: { shop: input.shop, requestId: input.requestId, ...keys(input), keyId, snapshot: encrypt(input.shop, input.requestId, report), receivedAt, dueAt: new Date(receivedAt.valueOf() + 30 * DAY) } });
      for (const batch of chunked(input.orderIds)) await tx.privacyRequestOrder.createMany({ data: batch.map(orderId => ({ requestId: row.id, orderId })) });
      return row.id;
    });
  }

  async function exportData(shop, requestId) {
    return transaction(async tx => {
      const row = await tx.privacyRequest.findFirst({ where: { id: requestId, shop } });
      if (!row) throw fail('Privacy request not found.', 404);
      if (row.status !== 'ready' || !row.snapshot) throw fail('This export has been cleared.', 410);
      const report = decrypt(row);
      await tx.privacyRequest.update({ where: { id: row.id }, data: { exports: { increment: 1 }, lastExportAt: now() } });
      return report;
    });
  }

  async function redact(input) {
    return transaction(async tx => {
      // A replaced key must not cause an email-only erasure to silently miss records.
      await checkKey(tx, input.shop);
      await redactPrivacyRecords(tx, { shop: input.shop, ...keys(input), orderIds: input.orderIds }, now(), recordRecovery);
    });
  }
  async function status() {
    const where = { status: 'ready' };
    const [pending, overdue, dueWithin48Hours, keyMismatch, oldest] = await Promise.all([
      db.privacyRequest.count({ where }),
      db.privacyRequest.count({ where: { ...where, dueAt: { lte: now() } } }),
      db.privacyRequest.count({ where: { ...where, dueAt: { lte: new Date(now().valueOf() + 2 * DAY) } } }),
      db.privacyRequest.count({ where: { ...where, OR: [{ keyId: null }, { keyId: { not: keyId } }] } }),
      db.privacyRequest.findFirst({ where, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
    ]);
    return { pending, overdue, dueWithin48Hours, keyMismatch, oldestReceivedAt: oldest?.receivedAt.toISOString() || null };
  }
  async function verifyPending() {
    // Offline recovery validation must not count as a merchant export/download.
    // Read one bounded snapshot at a time instead of loading the whole queue.
    let cursor, checked = 0;
    while (true) {
      const row = await db.privacyRequest.findFirst({ where: { status: 'ready', ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, select: { id: true, shop: true, requestId: true, snapshot: true, keyId: true } });
      if (!row) return { checked };
      if (row.keyId !== keyId || ++checked > 100000) throw fail('Privacy export needs operator assistance.', 503);
      decrypt(row); cursor = row.id;
    }
  }
  return { accept, exportData, redact, status, verifyPending };
}

export async function completePrivacyRequest(db, shop, id, now = new Date(), recordRecovery = async (_tx, _event) => {}) {
  return db.$transaction(async tx => {
    const row = await tx.privacyRequest.findFirst({ where: { id, shop } });
    if (!row) throw fail('Privacy request not found.', 404);
    if (row.status === 'completed') return;
    if (row.status !== 'ready' || !row.lastExportAt) throw fail('Download the export before marking it handled.', 409);
    await recordRecovery(tx, { type: 'complete-request', shop, requestId: id });
    await tx.accessEvent.deleteMany({ where: { shop, requestId: id } });
    await tx.privacyRequestOrder.deleteMany({ where: { requestId: id } });
    await tx.privacyRequest.update({ where: { id }, data: { snapshot: null, keyId: null, customerKey: null, emailKey: null, status: 'completed', finishedAt: now } });
  });
}

// Reusable erasure operation for authenticated live requests and offline replay.
// Only keyed identifiers and order references enter the encrypted recovery log.
export async function redactPrivacyRecords(tx, input, at, recordRecovery = async (_tx, _event) => {}) {
  const { shop, customerKey, emailKey, orderIds } = input;
  const requestIds = new Set();
  const identityFilters = Object.entries({ customerKey, emailKey }).filter(([, value]) => value).map(([name, value]) => ({ [name]: value }));
  if (identityFilters.length) {
    for (const row of await tx.privacyRequest.findMany({ where: { shop, status: 'ready', OR: identityFilters }, select: { id: true } })) requestIds.add(row.id);
  }
  for (const batch of chunked(orderIds)) {
    for (const row of await tx.privacyRequest.findMany({ where: { shop, status: 'ready', orders: { some: { orderId: { in: batch } } } }, select: { id: true } })) requestIds.add(row.id);
  }
  const orders = new Set(orderIds);
  for (const batch of chunked([...requestIds])) {
    await tx.accessEvent.deleteMany({ where: { shop, requestId: { in: batch } } });
    for (const row of await tx.privacyRequestOrder.findMany({ where: { requestId: { in: batch } }, select: { orderId: true } })) orders.add(row.orderId);
  }
  await recordRecovery(tx, { type: 'erase-customer', shop, customerKey, emailKey, orderIds: [...orders].sort() });
  for (const batch of chunked([...requestIds])) {
    await tx.privacyRequestOrder.deleteMany({ where: { requestId: { in: batch } } });
    await tx.privacyRequest.updateMany({ where: { shop, id: { in: batch } }, data: { snapshot: null, keyId: null, customerKey: null, emailKey: null, status: 'redacted', finishedAt: at, lastExportAt: null, exports: 0 } });
  }
  for (const batch of chunked([...orders])) await tx.automationJob.updateMany({ where: { shop, orderId: { in: batch } }, data: {
    orderId: '', requestHash: '', status: 'revoked', fingerprint: null, templateRevision: null, pdfSha256: null,
    expiresAt: null, leaseId: null, leaseUntil: null, nextAttemptAt: null, lastError: null, lastDownloadedAt: null, downloads: 0, attempts: 0, ttlHours: 0, retryDeadline: at, createdAt: at,
  } });
  // Aggregate used counts contain no customer identifiers. Erasure clears order
  // references and pending reservations without refunding successful past work.
  for (const batch of chunked([...orders])) await tx.usageOrder.deleteMany({ where: { shop, orderId: { in: batch } } });
  for (const batch of chunked([...orders])) await tx.accessEvent.deleteMany({ where: { shop, orderId: { in: batch } } });
}

export async function applyRecoveryEvent(tx, event, at) {
  if (event.type === 'erase-shop') return erasePrivacyShop(tx, event.shop);
  if (event.type === 'erase-customer') return redactPrivacyRecords(tx, event, at);
  if (event.type !== 'complete-request') throw new Error('Unknown recovery event.');
  await tx.accessEvent.deleteMany({ where: { shop: event.shop, requestId: event.requestId } });
  const row = await tx.privacyRequest.findFirst({ where: { id: event.requestId, shop: event.shop } });
  if (row?.status !== 'ready') return;
  await tx.privacyRequestOrder.deleteMany({ where: { requestId: row.id } });
  await tx.privacyRequest.update({ where: { id: row.id }, data: { snapshot: null, keyId: null, customerKey: null, emailKey: null, status: 'completed', finishedAt: at } });
}
