import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  if (topic === 'SHOP_REDACT') {
    await db.$transaction([db.session.deleteMany({ where: { shop } }), db.brand.deleteMany({ where: { shop } }), db.documentTemplate.deleteMany({ where: { shop } }), db.automationSettings.deleteMany({ where: { shop } })]);
  } else if (topic === 'CUSTOMERS_REDACT') {
    const orderIds = Array.isArray(payload.orders_to_redact) ? payload.orders_to_redact.map((id: unknown) => String(id)).filter((id: string) => /^[1-9]\d*$/.test(id)).map((id: string) => `gid://shopify/Order/${id}`) : [];
    // Keep a content-free run tombstone so a delayed Flow replay cannot recreate
    // a document after redaction. Retention cleanup removes it after 30 days.
    if (orderIds.length) await db.automationJob.updateMany({ where: { shop, orderId: { in: orderIds } }, data: {
      orderId: '', requestHash: '', status: 'revoked', fingerprint: null, templateRevision: null, pdfSha256: null,
      expiresAt: null, leaseId: null, leaseUntil: null, nextAttemptAt: null, lastDownloadedAt: null, downloads: 0,
    } });
  } else if (topic !== 'CUSTOMERS_DATA_REQUEST' && topic !== 'CUSTOMERS_REDACT') {
    return new Response(null, { status: 404 });
  }
  // Orders/PDFs are not stored. Order references in the automation ledger are
  // erased by customer redaction. Data-request fulfillment remains a launch gate;
  // acknowledging the webhook is not a claim that an export has been delivered.
  return new Response(null, { status: 204 });
};
