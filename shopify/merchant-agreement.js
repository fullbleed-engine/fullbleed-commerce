// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import publishedAgreement from './agreements/2026-10-04.js';
import { staffActor } from './access-audit.js';

const document = JSON.stringify(publishedAgreement);
export const merchantAgreement = Object.freeze({ ...publishedAgreement, documentSha256: createHash('sha256').update(document).digest('hex') });
export const agreementHeaders = Object.freeze({ 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
const fail = (message = 'Agreement records are temporarily unavailable. Try again later.', status = 503) => new Response(message, { status, headers: agreementHeaders });
const validShop = shop => typeof shop === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
const current = row => Boolean(row && row.version === merchantAgreement.version && row.documentSha256 === merchantAgreement.documentSha256);

export function validateAgreementForm(form) {
  const expected = { intent: 'accept', version: merchantAgreement.version, documentSha256: merchantAgreement.documentSha256, accepted: 'yes' };
  if ([...form.keys()].some(key => !Object.hasOwn(expected, key)) ||
      Object.entries(expected).some(([key, value]) => form.getAll(key).length !== 1 || form.get(key) !== value)) {
    throw fail('Review the current agreement and confirm your authority to accept it for this store.', 400);
  }
}

export function createMerchantAgreement({ db, now = () => new Date() }) {
  async function status(shop) {
    if (!validShop(shop)) throw fail('Reopen Fullbleed in Shopify.', 401);
    try {
      const row = await db.agreementAcceptance.findUnique({ where: { shop } });
      return { accepted: current(row), version: row?.version || null, acceptedAt: row?.acceptedAt || null };
    } catch { throw fail(); }
  }
  async function requireAccepted(shop) {
    if (!(await status(shop)).accepted) throw fail('Open Fullbleed and accept the merchant agreement before preparing documents.', 428);
  }
  async function accept(context, form) {
    validateAgreementForm(form);
    // The route supplies the context returned by Shopify's authenticator.
    const shop = context?.session?.shop, actor = staffActor(context?.sessionToken);
    if (!validShop(shop)) throw fail('Reopen Fullbleed in Shopify.', 401);
    const acceptedAt = now();
    if (!Number.isFinite(acceptedAt.valueOf())) throw fail();
    try {
      return await db.$transaction(async tx => {
        const session = await tx.session.findUnique({ where: { id: `offline_${shop}` }, select: { shop: true } });
        if (session?.shop !== shop) throw fail('Reopen the installed Fullbleed app before accepting.', 401);
        const previous = await tx.agreementAcceptance.findUnique({ where: { shop } });
        if (current(previous)) return { accepted: true, version: previous.version, acceptedAt: previous.acceptedAt };
        const data = { version: merchantAgreement.version, documentSha256: merchantAgreement.documentSha256, actorId: actor.id, acceptedAt };
        await tx.agreementAcceptance.upsert({ where: { shop }, create: { shop, ...data }, update: data });
        return { accepted: true, version: data.version, acceptedAt };
      });
    } catch (error) { if (error instanceof Response) throw error; throw fail(); }
  }
  return { status, requireAccepted, accept };
}
