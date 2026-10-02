import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  if (topic === 'SHOP_REDACT') {
    await db.$transaction([db.session.deleteMany({ where: { shop } }), db.brand.deleteMany({ where: { shop } })]);
  } else if (topic !== 'CUSTOMERS_DATA_REQUEST' && topic !== 'CUSTOMERS_REDACT') {
    return new Response(null, { status: 404 });
  }
  // Customer records and documents are not persisted; there are no saved records
  // for customer export/redaction. Never log payloads or customer identifiers.
  return new Response(null, { status: 204 });
};
