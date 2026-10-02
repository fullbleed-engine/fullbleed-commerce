// SPDX-License-Identifier: GPL-2.0-or-later
import type { LoaderFunctionArgs, HeadersFunction } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { commerceAccess, brandForShop, documentOptions, withRenderLimit } from '../commerce.server';
import { fetchShopifyOrder } from '../../../adapter.js';
import { renderOrder } from '../../../../src/node.js';
import { createTemplateStore } from '../../../templates.js';
import db from '../db.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, shop } = await commerceAccess(request);
  return withRenderLimit(session.shop, async () => {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') || 'order-summary';
    const orderId = url.searchParams.get('order') || '';
    if (!['order-summary', 'packing-slip'].includes(kind) || !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(orderId)) return new Response('Select an order and document type.', { status: 400 });
    try {
      const brand = await brandForShop(session.shop, shop.name);
      const order = await fetchShopifyOrder(admin, orderId, { name: brand.sellerName, lines: brand.sellerLines.split(/\r?\n/).filter(Boolean) }, { timeZone: shop.ianaTimezone });
      const { template } = await createTemplateStore(db).get(session.shop, kind);
      const result = await renderOrder(order, { ...documentOptions(brand), kind, template, signal: request.signal });
      return new Response(new Uint8Array(result.pdf), { headers: {
        'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff',
      } });
    } catch (error) {
      if (error instanceof Response) throw error;
      if (error instanceof TypeError) return new Response(error.message, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      return new Response('The document could not be completed. Check order support, character coverage and app permissions, then try again.', { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
  });
}

export const headers: HeadersFunction = args => boundary.headers(args);
