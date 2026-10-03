// SPDX-License-Identifier: MIT
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const flowKinds = Object.freeze({
  'create-order-summary-link': 'order-summary',
  'create-packing-slip-link': 'packing-slip',
});
const privateHeaders = { 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export const flowResponse = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...privateHeaders, ...headers } });
const reject = (message, status = 400) => flowResponse({ message }, status);
const hash = data => createHash('sha256').update(data).digest('hex');
const MAX_ATTEMPTS = 8;
const MAX_AGE = 36 * 60 * 60 * 1000;

export async function pruneAutomationJobs(db, now = new Date()) {
  return db.automationJob.deleteMany({ where: { createdAt: { lt: new Date(now.valueOf() - 30 * 24 * 3600000) } } });
}

export function parseFlowPayload(payload, shop, shopId) {
  const kind = Object.hasOwn(flowKinds, payload?.handle || '') ? flowKinds[payload.handle] : null;
  const runId = payload?.action_run_id;
  const orderId = payload?.properties?.order_id;
  // Flow initializes an optional integer field to 0 in its native editor.
  const configuredHours = payload?.properties?.expires_in_hours;
  const ttlHours = configuredHours == null || configuredHours === 0 ? 24 : configuredHours;
  if (payload?.shopify_domain !== shop || `gid://shopify/Shop/${payload?.shop_id}` !== shopId) throw reject('The action does not belong to this store.', 403);
  if (!kind || typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw reject('Choose a current Fullbleed document action.');
  if (typeof orderId !== 'string' || !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(orderId)) throw reject('This action needs an order.');
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 72) throw reject('Document links must expire in 1 to 72 hours.');
  const input = { shop, runId, handle: payload.handle, orderId, kind, ttlHours };
  return { ...input, requestHash: hash(JSON.stringify(input)) };
}

/** Bound untrusted requests before the official Shopify authenticator reads them. */
export async function boundedFlowRequest(request) {
  if (request.method !== 'POST') throw reject('Use POST.', 405);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw reject('Send JSON.', 415);
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  try {
    if (!reader) throw reject('A Flow request is required.');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); throw reject('The action request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader?.releaseLock(); }
  const body = Buffer.concat(chunks);
  try { JSON.parse(body.toString('utf8')); } catch { throw reject('The action request is not valid JSON.'); }
  return new Request(request.url, { method: 'POST', headers: request.headers, body, signal: request.signal });
}

/**
 * Flow supplies durable delivery and status polling. The database supplies the
 * lease, retry state and unique action-run constraint, across process restarts.
 * loadDocument must recheck installation and entitlement before reading orders.
 */
export function createFlowService({ db, loadDocument, render, limit, secret, appUrl, now = () => new Date() }) {
  if (typeof secret !== 'string' || secret.length < 24) throw new Error('A document signing secret is required.');
  const origin = new URL(appUrl);
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('A trusted HTTPS app URL is required.');
  const mac = (purpose, value) => createHmac('sha256', secret).update(`fullbleed:${purpose}:v1\n${value}`).digest('base64url');
  const tokenFor = job => mac('document-link', `${job.id}\n${job.shop}\n${job.expiresAt.toISOString()}`);
  const fingerprint = document => mac('document-input', JSON.stringify(document));
  const active = new Map();

  async function accept(input) {
    return db.$transaction(async tx => {
      const setting = await tx.automationSettings.findUnique({ where: { shop: input.shop } });
      const session = await tx.session.findUnique({ where: { id: `offline_${input.shop}` } });
      if (!session || !setting?.enabled) throw reject('Enable document automation in Fullbleed before running this workflow.', 409);
      const existing = await tx.automationJob.findUnique({ where: { shop_runId: { shop: input.shop, runId: input.runId } } });
      if (existing) {
        // Redacted run tombstones reject all replays without retaining an order hash.
        if (existing.status === 'revoked' && existing.orderId === '') return existing;
        if (existing.requestHash !== input.requestHash) throw reject('This action run was already used with different settings.', 409);
        return existing;
      }
      return tx.automationJob.create({ data: { ...input, retryDeadline: new Date(now().valueOf() + MAX_AGE) } });
    });
  }

  function status(job) {
    if (job.status === 'ready') {
      if (!job.expiresAt || job.expiresAt <= now()) return reject('This document link expired. Run a new workflow to create another.', 410);
      return flowResponse({ return_value: {
        id: job.id, downloadUrl: `${origin.origin}/documents/${job.id}#${tokenFor(job)}`,
        expiresAt: job.expiresAt.toISOString(), sha256: job.pdfSha256,
      } });
    }
    if (['cancelled', 'revoked', 'stale'].includes(job.status)) return reject('This document was revoked or changed. Run a new workflow after checking the order and template.', 410);
    if (job.status === 'failed') return reject('The document could not be prepared. Check the order and template, then retry from Fullbleed activity.', 422);
    if (job.nextAttemptAt && job.nextAttemptAt > now()) return flowResponse({ message: 'The document will be retried.' }, 429, { 'Retry-After': String(Math.min(3600, Math.max(5, Math.ceil((job.nextAttemptAt - now()) / 1000)))) });
    return flowResponse({ message: 'Document preparation is in progress.' }, 202);
  }

  async function perform(id) {
    let job = await db.automationJob.findUnique({ where: { id } });
    if (!job || !['pending', 'retry-wait', 'running'].includes(job.status)) return;
    const at = now();
    if (job.nextAttemptAt > at || job.leaseUntil > at) return;
    if (job.attempts >= MAX_ATTEMPTS || at >= job.retryDeadline) {
      await db.automationJob.updateMany({ where: { id, status: job.status, leaseId: job.leaseId }, data: { status: 'failed', lastError: 'retry_limit', leaseId: null, leaseUntil: null } });
      return;
    }
    try {
      await limit(job.shop, async () => {
        // Reserve local capacity before spending an attempt. The durable lease
        // still prevents duplicate preparation by another service/process.
        const leaseId = randomUUID();
        const claimed = await db.automationJob.updateMany({ where: { id, status: job.status, leaseId: job.leaseId, attempts: job.attempts }, data: {
          status: 'running', leaseId, leaseUntil: new Date(now().valueOf() + 90000), attempts: { increment: 1 }, nextAttemptAt: null,
        } });
        if (!claimed.count) return;
        job = { ...job, attempts: job.attempts + 1 };
        const owned = { id, status: 'running', leaseId };
        try {
          const setting = await db.automationSettings.findUnique({ where: { shop: job.shop } });
          if (!setting?.enabled) throw reject('Automation is paused.', 409);
          const signal = AbortSignal.timeout(60000);
          const document = await loadDocument(job, signal);
          const result = await render(document.order, { ...document.options, signal });
          if (result.pdf.length > 8 * 1024 * 1024 || Buffer.from(result.pdf).subarray(0, 5).toString() !== '%PDF-') throw new TypeError('Invalid document output.');
          await db.automationJob.updateMany({ where: owned, data: {
            status: 'ready', fingerprint: fingerprint(document), templateRevision: document.revision,
            pdfSha256: hash(result.pdf), expiresAt: new Date(now().valueOf() + job.ttlHours * 3600000),
            leaseId: null, leaseUntil: null, lastError: null,
          } });
        } catch (error) {
          const terminal = error instanceof TypeError || (error instanceof Response && error.status >= 400 && error.status < 500 && error.status !== 429);
          await db.automationJob.updateMany({ where: owned, data: {
            status: terminal || job.attempts >= MAX_ATTEMPTS ? 'failed' : 'retry-wait',
            lastError: terminal ? 'order_or_access' : 'temporarily_unavailable', leaseId: null, leaseUntil: null,
            nextAttemptAt: terminal ? null : new Date(now().valueOf() + Math.min(3600, 15 * 2 ** (job.attempts - 1)) * 1000),
          } });
        }
      });
    } catch (error) {
      if (!(error instanceof Response) || error.status !== 429) throw error;
      // A capacity wait reads no order and starts no render. Keep the retry
      // budget intact and never overwrite a competing lease, pause or erasure.
      await db.automationJob.updateMany({ where: {
        id, status: job.status, leaseId: job.leaseId, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt,
      }, data: {
        status: 'retry-wait', lastError: 'capacity_wait', leaseId: null, leaseUntil: null,
        nextAttemptAt: new Date(Math.min(job.retryDeadline.valueOf(), now().valueOf() + 5000)),
      } });
    }
  }

  function start(id) {
    if (!active.has(id)) {
      const work = perform(id).catch(() => { /* A database outage leaves an expiring lease for Flow's next delivery. */ }).finally(() => active.delete(id));
      active.set(id, work);
    }
    return active.get(id);
  }

  async function download(id, token) {
    if (!/^[0-9a-f-]{36}$/.test(id || '') || !/^[A-Za-z0-9_-]{43}$/.test(token || '')) return reject('This download link is not available.', 404);
    const job = await db.automationJob.findUnique({ where: { id } });
    if (!job?.expiresAt || !timingSafeEqual(Buffer.from(token), Buffer.from(tokenFor(job)))) return reject('This download link is not available.', 404);
    if (job.status !== 'ready' || job.expiresAt <= now()) return reject('This download link expired or was revoked.', 410);
    const setting = await db.automationSettings.findUnique({ where: { shop: job.shop } });
    if (!setting?.enabled) return reject('Document downloads are paused by the store.', 410);
    return limit(job.shop, async () => {
      try {
        const signal = AbortSignal.timeout(60000);
        const document = await loadDocument(job, signal);
        if (fingerprint(document) !== job.fingerprint) {
          await db.automationJob.updateMany({ where: { id, status: 'ready' }, data: { status: 'stale', lastError: 'document_changed' } });
          return reject('The order or template changed. Ask the store for a new document link.', 410);
        }
        const result = await render(document.order, { ...document.options, signal });
        if (hash(result.pdf) !== job.pdfSha256) return reject('The document version changed. Ask the store for a new link.', 410);
        // Recheck revocation after rendering, including pause/uninstall races.
        const saved = await db.automationJob.updateMany({ where: { id, status: 'ready', expiresAt: { gt: now() } }, data: { downloads: { increment: 1 }, lastDownloadedAt: now() } });
        if (!saved.count) return reject('This download link expired or was revoked.', 410);
        return new Response(new Uint8Array(result.pdf), { headers: { ...privateHeaders, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${result.filename}"`, 'X-Fullbleed-SHA256': job.pdfSha256 } });
      } catch (error) {
        if (error instanceof Response && error.status === 429) throw error;
        return reject('This document is currently unavailable. Ask the store to check the order and app access.', error instanceof TypeError ? 410 : 503);
      }
    });
  }

  async function setEnabled(shop, enabled) {
    await db.$transaction(async tx => {
      if (!await tx.session.findUnique({ where: { id: `offline_${shop}` } })) throw reject('Reopen the installed Fullbleed app before changing automation.', 409);
      await tx.automationSettings.upsert({ where: { shop }, create: { shop, enabled }, update: { enabled } });
      if (!enabled) await tx.automationJob.updateMany({ where: { shop, status: { in: ['pending', 'running', 'retry-wait', 'ready'] } }, data: { status: 'revoked', leaseId: null, leaseUntil: null } });
    });
  }

  async function revoke(shop, id) {
    await db.automationJob.updateMany({ where: { shop, id }, data: { status: 'revoked', leaseId: null, leaseUntil: null } });
  }

  async function retry(shop, id) {
    if (!(await db.automationSettings.findUnique({ where: { shop } }))?.enabled) throw reject('Enable automation before retrying.', 409);
    const updated = await db.automationJob.updateMany({ where: { shop, id, status: { in: ['failed', 'retry-wait'] } }, data: { status: 'pending', attempts: 0, retryDeadline: new Date(now().valueOf() + MAX_AGE), nextAttemptAt: null, leaseId: null, leaseUntil: null, lastError: null } });
    if (updated.count) start(id);
  }

  return { accept, status, start, download, setEnabled, revoke, retry };
}
