// SPDX-License-Identifier: GPL-2.0-or-later
import db from './db.server';
import { unauthenticated } from './shopify.server';
import { brandForShop, documentOptions, verifyCommerceShop, withRenderLimit, usageMeter } from './commerce.server';
import { fetchShopifyOrder } from '../../adapter.js';
import { createTemplateStore } from '../../templates.js';
import { createFlowService } from '../../flow.js';
import { renderOrder } from '../../../src/node.js';

let service: ReturnType<typeof createFlowService>;
export function flowService() {
  if (!service) service = createFlowService({
    db, secret: process.env.SHOPIFY_API_SECRET, appUrl: process.env.SHOPIFY_APP_URL,
    limit: withRenderLimit, render: renderOrder,
    async withDocument(job: { shop: string; orderId: string; kind: string }, signal: AbortSignal, work: (document: object) => Promise<unknown>) {
      const { admin } = await unauthenticated.admin(job.shop);
      const { shop, allowance } = await verifyCommerceShop(admin, job.shop, signal);
      return usageMeter.run(job.shop, job.orderId, allowance, async () => {
        const brand = await brandForShop(job.shop, shop.name);
        const saved = await createTemplateStore(db).get(job.shop, job.kind);
        const order = await fetchShopifyOrder(admin, job.orderId, { name: brand.sellerName, lines: brand.sellerLines.split(/\r?\n/).filter(Boolean) }, { timeZone: shop.ianaTimezone, signal });
        return work({ order, revision: saved.revision, options: { ...documentOptions(brand), kind: job.kind, template: saved.template } });
      });
    },
  });
  return service;
}
