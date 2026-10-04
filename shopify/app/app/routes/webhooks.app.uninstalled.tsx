import type { ActionFunctionArgs } from 'react-router';
import { authenticateLifecycleWebhook, parseLifecyclePayload } from '../webhooks.server';
import db from '../db.server';
import { erasePrivacyShop } from '../../../privacy.js';
import { recordRecovery } from '../recovery.server';

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, rawBody } = await authenticateLifecycleWebhook(request, ['APP_UNINSTALLED']);
  const payload = parseLifecyclePayload(rawBody);
  // Shopify's documented sample permits null, but a supplied domain must agree.
  if (payload.myshopify_domain != null && payload.myshopify_domain !== shop) return new Response(null, { status: 403 });
  await db.$transaction(tx => erasePrivacyShop(tx, shop, recordRecovery));
  return new Response(null, { status: 204 });
};
