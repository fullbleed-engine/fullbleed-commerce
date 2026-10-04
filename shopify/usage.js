// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';

// These are fixed allowances, never usage charges. Only a verified current
// Partner API subscription can select a production plan.
export const plans = Object.freeze({
  studio: Object.freeze({ name: 'Studio', orders: 250, usdMonthly: 12 }),
  scale: Object.freeze({ name: 'Scale', orders: 1000, usdMonthly: 29 }),
  'shopify-test': Object.freeze({ name: 'Development test', orders: 250, usdMonthly: 0 }),
});
const headers = { 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const fail = (message, status = 503, extra = {}) => new Response(message, { status, headers: { ...headers, ...extra } });
const leaseMs = 90000;
const day = 86400000;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : null;

export function usageAllowance(subscription, at = new Date()) {
  const plan = Object.hasOwn(plans, subscription?.handle || '') && plans[subscription.handle];
  if (!plan || subscription.billingPeriod !== 'EVERY_30_DAYS') throw fail('Your plan allowance could not be verified. Please try again or contact support.');
  const start = date(subscription.currentBillingCycle?.startTime);
  const end = date(subscription.currentBillingCycle?.endTime);
  const trialEnd = date(subscription.trialEndsAt);
  if (start && end && start <= at && end > at && end - start <= 32 * day) {
    return { ...plan, handle: subscription.handle, key: `cycle:${start.toISOString()}`, startsAt: start, endsAt: end, trial: false };
  }
  if (subscription.currentBillingCycle == null && trialEnd && trialEnd > at && trialEnd - at <= 366 * day) {
    return { ...plan, handle: subscription.handle, key: `trial:${trialEnd.toISOString()}`, startsAt: null, endsAt: trialEnd, trial: true };
  }
  throw fail('Your billing period could not be verified. Please try again.');
}

export function developmentAllowance(at = new Date()) {
  const startsAt = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const endsAt = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { ...plans['shopify-test'], handle: 'shopify-test', key: `development:${startsAt.toISOString()}`, startsAt, endsAt, trial: false };
}

export function isUsageLimit(error) {
  return error instanceof Response && error.status === 409 && error.headers.get('X-Fullbleed-Error') === 'usage_limit';
}

/** One successful order per billing period; both documents and reprints share it.
 * Transactions never hold a database lock while fetching or rendering. Pending
 * reservations occupy capacity, expire after crashes, and cannot resurrect an
 * erased order or installation. Application render deadlines are shorter leases.
 */
export function createUsageMeter({ db, now = () => new Date() }) {
  const transaction = action => db.$transaction(action, { maxWait: 2000, timeout: 5000 });
  function validate(shop, allowance) {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !allowance?.key || !Number.isInteger(allowance.orders) || allowance.orders < 1 || !(allowance.endsAt > now())) throw fail('The order allowance needs to be refreshed.');
  }
  async function reserve(shop, orderId, allowance) {
    validate(shop, allowance);
    if (!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(orderId)) throw new TypeError('A Shopify order is required.');
    return transaction(async tx => {
      // Write first so two SQLite clients cannot both read a free final slot.
      await tx.usageOrder.deleteMany({ where: { shop, completedAt: null, reservedUntil: { lte: now() } } });
      if (!await tx.session.findFirst({ where: { id: `offline_${shop}`, shop, isOnline: false } })) throw fail('Reopen the installed Fullbleed app before preparing documents.', 409);
      const period = await tx.usagePeriod.upsert({ where: { shop_key: { shop, key: allowance.key } },
        create: { shop, key: allowance.key, startsAt: allowance.startsAt, endsAt: allowance.endsAt }, update: { endsAt: allowance.endsAt } });
      const existing = await tx.usageOrder.findUnique({ where: { periodId_orderId: { periodId: period.id, orderId } } });
      if (existing?.completedAt) return { id: existing.id, periodId: period.id, committed: true };
      if (existing) throw fail('This order is already being prepared. Please retry shortly.', 429, { 'Retry-After': '5' });
      const pending = await tx.usageOrder.count({ where: { periodId: period.id, completedAt: null } });
      if (period.used + pending >= allowance.orders) throw fail('This plan’s order allowance is used. Open Plan and usage to change plans, or retry when the next billing period starts. Reprints of orders already counted this period remain available.', 409, { 'X-Fullbleed-Error': 'usage_limit' });
      const row = await tx.usageOrder.create({ data: { id: randomUUID(), periodId: period.id, shop, orderId, reservedUntil: new Date(now().valueOf() + leaseMs) } });
      return { id: row.id, periodId: period.id, committed: false };
    });
  }
  async function run(shop, orderId, allowance, task) {
    const receipt = await reserve(shop, orderId, allowance);
    try {
      const result = await task();
      if (result instanceof Response && !result.ok) throw result;
      await transaction(async tx => {
        if (receipt.committed) {
          if (!await tx.usageOrder.findUnique({ where: { id: receipt.id } })) throw fail('This order’s document access changed. Reopen the app and try again.', 409);
          return;
        }
        const saved = await tx.usageOrder.updateMany({ where: { id: receipt.id, completedAt: null, reservedUntil: { gt: now() } }, data: { completedAt: now(), reservedUntil: null } });
        if (!saved.count) throw fail('This document request expired or was cleared. Please try again.', 409);
        await tx.usagePeriod.update({ where: { id: receipt.periodId }, data: { used: { increment: 1 } } });
      });
      return result;
    } catch (error) {
      if (!receipt.committed) await db.usageOrder.deleteMany({ where: { id: receipt.id, completedAt: null } });
      throw error;
    }
  }
  async function status(shop, allowance) {
    validate(shop, allowance);
    const row = await db.usagePeriod.findUnique({ where: { shop_key: { shop, key: allowance.key } }, include: { _count: { select: { orders: { where: { completedAt: null, reservedUntil: { gt: now() } } } } } } });
    const used = row?.used || 0, preparing = row?._count.orders || 0;
    return { used, preparing, remaining: Math.max(0, allowance.orders - used - preparing), limit: allowance.orders };
  }
  return { run, status };
}

// Keep order references only for the current period plus a 30-day support window.
export async function pruneUsage(db, at = new Date()) {
  return db.usagePeriod.deleteMany({ where: { endsAt: { lt: new Date(at.valueOf() - 30 * day) } } });
}
