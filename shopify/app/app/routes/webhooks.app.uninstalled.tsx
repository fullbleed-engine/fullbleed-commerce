import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { erasePrivacyShop } from '../../../privacy.js';
import { recordRecovery } from '../recovery.server';

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.$transaction(tx => erasePrivacyShop(tx, shop, recordRecovery));
  return new Response(null, { status: 204 });
};
