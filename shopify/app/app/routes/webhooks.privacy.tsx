import type { ActionFunctionArgs } from 'react-router';
import { authenticateLifecycleWebhook } from '../webhooks.server';
import db from '../db.server';
import { privacyService } from '../privacy.server';
import { erasePrivacyShop, parsePrivacyPayload } from '../../../privacy.js';
import { recordRecovery } from '../recovery.server';

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, body } = await authenticateLifecycleWebhook(request, ['SHOP_REDACT', 'CUSTOMERS_REDACT', 'CUSTOMERS_DATA_REQUEST']);
  const input = parsePrivacyPayload(body, shop, topic);
  if (topic === 'SHOP_REDACT') await db.$transaction(tx => erasePrivacyShop(tx, shop, recordRecovery));
  else if (topic === 'CUSTOMERS_REDACT') await privacyService().redact(input);
  else await privacyService().accept(input);
  // A receipt means the export was captured, not that the merchant delivered it.
  return new Response(null, { status: 204 });
};
