// SPDX-License-Identifier: MIT
import '@shopify/shopify-api/adapters/web-api';
import { LogSeverity, shopifyApi, ValidationErrorReason, WebhookType } from '@shopify/shopify-api';
import { apiVersion } from './shopify.server';
import { readPrivacyWebhook } from '../../privacy.js';

const api = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || '',
  apiSecretKey: process.env.SHOPIFY_API_SECRET || '',
  apiVersion,
  isEmbeddedApp: true,
  hostName: new URL(process.env.SHOPIFY_APP_URL || '').host,
  logger: { level: LogSeverity.Error },
});

// The React Router SDK's authenticate.webhook also refreshes offline tokens.
// Uninstall revokes those tokens, and mandatory privacy work must not depend on
// Admin API access. Use Shopify's signature validator without loading a session.
export async function authenticateLifecycleWebhook(request: Request, topics: readonly string[]) {
  const bounded = await readPrivacyWebhook(request);
  let rawBody: string;
  try { rawBody = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bounded.body); }
  catch { throw new Response(null, { status: 400 }); }
  const check = await api.webhooks.validate({ rawBody, rawRequest: bounded.request });
  if (!check.valid) throw new Response(null, { status: check.reason === ValidationErrorReason.InvalidHmac ? 401 : 400 });
  if (check.webhookType !== WebhookType.Webhooks || !topics.includes(check.topic)) throw new Response(null, { status: 404 });
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(check.domain)) throw new Response(null, { status: 403 });
  return { shop: check.domain, topic: check.topic, body: bounded.body, rawBody };
}

export function parseLifecyclePayload(rawBody: string): Record<string, unknown> {
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { throw new Response(null, { status: 400 }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Response(null, { status: 400 });
  return payload;
}
