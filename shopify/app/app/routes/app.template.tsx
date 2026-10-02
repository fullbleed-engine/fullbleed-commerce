// SPDX-License-Identifier: GPL-2.0-or-later
// Resource route: fetch callers must receive JSON/PDF, not a rendered document.
import type { ActionFunctionArgs } from 'react-router';
import db from '../db.server';
import { brandForShop, commerceAccess, documentOptions, withRenderLimit } from '../commerce.server';
import { createTemplateStore, readTemplateRequest } from '../../../templates.js';
import { renderOrder } from '../../../../src/node.js';
import { fetchShopifyOrder } from '../../../adapter.js';
const store = createTemplateStore(db);
const noStore = { 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff' };

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session, shop } = await commerceAccess(request);
  try {
    const input = await readTemplateRequest(request);
    if (input.intent !== 'preview') return Response.json(await store.save(session.shop, input.kind, input.template, input.revision), { headers: noStore });
    if (typeof input.order !== 'string' || !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(input.order)) return new Response('Select an order for the preview.', { status: 400, headers: noStore });
    return await withRenderLimit(session.shop, async () => {
      const brand = await brandForShop(session.shop, shop.name);
      const order = await fetchShopifyOrder(admin, input.order, { name: brand.sellerName, lines: brand.sellerLines.split(/\r?\n/).filter(Boolean) }, { timeZone: shop.ianaTimezone });
      const result = await renderOrder(order, { ...documentOptions(brand), kind: input.kind, template: input.template, signal: request.signal });
      return new Response(new Uint8Array(result.pdf), { headers: { ...noStore, 'Content-Type': 'application/pdf' } });
    });
  } catch (error) {
    if (error instanceof Response) { for (const [key, value] of Object.entries(noStore)) error.headers.set(key, value); return error; }
    return new Response(error instanceof TypeError ? error.message : 'The template request could not be completed. Check your order and retry.', { status: error instanceof TypeError ? 422 : 502, headers: noStore });
  }
}
