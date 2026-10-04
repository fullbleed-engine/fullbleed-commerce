import type { ActionFunctionArgs } from 'react-router';
import { authenticateLifecycleWebhook, parseLifecyclePayload } from '../webhooks.server';
import db from '../db.server';

export const action = async ({ request }: ActionFunctionArgs) => {
  const { rawBody, shop } = await authenticateLifecycleWebhook(request, ['APP_SCOPES_UPDATE']);
  const payload = parseLifecyclePayload(rawBody);
  if (!Array.isArray(payload.current) || payload.current.some((value: unknown) => typeof value !== 'string')) return new Response(null, { status: 400 });
  await db.session.updateMany({ where: { shop }, data: { scope: payload.current.join(',') } });
  return new Response(null, { status: 204 });
};
