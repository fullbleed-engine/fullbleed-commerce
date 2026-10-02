import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { privacyService } from '../privacy.server';
import { erasePrivacyShop, parsePrivacyPayload, readPrivacyWebhook } from '../../../privacy.js';

export const action = async ({ request }: ActionFunctionArgs) => {
  const bounded = await readPrivacyWebhook(request);
  const { topic, shop } = await authenticate.webhook(bounded.request);
  const input = parsePrivacyPayload(bounded.body, shop, topic);
  if (topic === 'SHOP_REDACT') await db.$transaction(tx => erasePrivacyShop(tx, shop));
  else if (topic === 'CUSTOMERS_REDACT') await privacyService().redact(input);
  else await privacyService().accept(input);
  // A receipt means the export was captured, not that the merchant delivered it.
  return new Response(null, { status: 204 });
};
