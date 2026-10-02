// SPDX-License-Identifier: MIT
import { fetchShopifyOrder } from './adapter.js';
import { renderOrder } from '../src/node.js';

/** Wire to the official Shopify React Router template's authenticate.admin.
 * Subscription access and seller settings must come from server-side sources.
 * No default that bypasses authentication or paid-plan verification is provided.
 */
export function createPdfLoader({ authenticate, requireEntitlement, sellerForShop, render = renderOrder }) {
  if (typeof authenticate?.admin !== 'function' || typeof requireEntitlement !== 'function' || typeof sellerForShop !== 'function') throw new TypeError('Authenticated Shopify, subscription, and seller providers are required.');
  return async function loader({ request }) {
    const { admin, session } = await authenticate.admin(request);
    await requireEntitlement(session.shop);
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') || 'order-summary';
    if (!['order-summary', 'packing-slip'].includes(kind)) return new Response('Unknown document type.', { status: 400 });
    const seller = await sellerForShop(session.shop);
    const order = await fetchShopifyOrder(admin, url.searchParams.get('order') || '', seller);
    const result = await render(order, { kind, signal: request.signal });
    return new Response(result.pdf, { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store, private, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    } });
  };
}
