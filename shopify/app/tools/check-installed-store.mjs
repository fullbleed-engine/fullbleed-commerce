// SPDX-License-Identifier: GPL-2.0-or-later
// Uses the application's own official offline-session API. Never prints or exports tokens.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { fetchShopifyOrder } from '../../adapter.js';
import { renderOrder } from '../../../src/node.js';
import { designs } from '../../../pro/designs.js';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(app, '../..');
const store = 'fullbleed-commerce-test.myshopify.com';
if (process.env.NODE_ENV !== 'development' || process.env.FULLBLEED_DEV_STORE !== store || process.env.SHOPIFY_API_KEY !== '91ba2420b9c9d87e00dab059b51eb005') throw new Error('This check is restricted to the registered Fullbleed development app and synthetic store.');
const output = resolve(root, 'output/shopify/installed-store');
await mkdir(output, { recursive: true });
const record = { checkedAt: new Date().toISOString(), store, developmentStoreVerified: false, source: 'Shopify Admin API using installed app offline session', documents: [], billingTested: false, browserTested: false, passed: false };
let step = 'load-installed-session';
try {
await mkdir(resolve(app, 'target'), { recursive: true });
const backend = resolve(app, 'target/shopify-server-check.mjs');
await build({ entryPoints: [resolve(app, 'app/shopify.server.ts')], outfile: backend, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { unauthenticated } = await import(pathToFileURL(backend).href);
const { admin, session } = await unauthenticated.admin(store);
const shopResponse = await admin.graphql(`query FullbleedInstalledShop { shop { id name myshopifyDomain ianaTimezone plan { partnerDevelopment } } }`);
const shop = (await shopResponse.json()).data?.shop;
if (!shop || shop.myshopifyDomain !== store || shop.plan.partnerDevelopment !== true) throw new Error('The store is not the authorized development store.');
Object.assign(record, { developmentStoreVerified: true, scope: session.scope, timeZone: shop.ianaTimezone });
step = 'read-synthetic-orders';
const orderResponse = await admin.graphql(`query FullbleedInstalledOrders { orders(first: 20, query: "tag:fullbleed-commerce-synthetic", sortKey: CREATED_AT, reverse: true) { nodes { id name } } }`);
const orders = (await orderResponse.json()).data?.orders?.nodes;
if (!orders?.length) throw new Error('The development store contains no test orders.');
step = 'read-synthetic-order-fields';
let order;
let rejected = 0;
for (const candidate of orders) {
  try {
    order = await fetchShopifyOrder(admin, candidate.id, { name: shop.name, lines: ['Synthetic development-store sample'] }, { timeZone: shop.ianaTimezone });
    break;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    rejected++;
  }
}
if (!order) throw new Error('No supported, unrefunded and unedited synthetic order was available.');
const documents = [];
step = 'render-documents';
for (const design of ['studio', 'contrast', 'quiet']) {
  for (const kind of ['order-summary', 'packing-slip']) {
    const result = await renderOrder(order, { kind, ...(design === 'studio' ? {} : { design: designs[design] }), previewDpi: 96 });
    const stem = `${design}-${kind}`;
    await writeFile(resolve(output, `${stem}.pdf`), result.pdf);
    for (const [index, png] of result.previews.entries()) await writeFile(resolve(output, `${stem}-${index + 1}.png`), png);
    documents.push({ stem, pages: result.pages, engineVersion: result.engineVersion, missingGlyphs: result.missingGlyphs, sha256: createHash('sha256').update(result.pdf).digest('hex') });
  }
}
Object.assign(record, { ordersAvailable: orders.length, unsupportedOrdersSkipped: rejected, documents, passed: true });
} catch (error) {
  // API errors can contain response headers and customer fields. Retain only a
  // classification, never the upstream object or authenticated session.
  const errors = error.body?.errors?.graphQLErrors || [];
  record.failure = { step, reason: errors.some(item => item.extensions?.code === 'ACCESS_DENIED' && /not approved/.test(item.message)) ? 'protected-customer-data-access-not-configured' : 'check-failed' };
  process.exitCode = 1;
}
await writeFile(resolve(output, 'verification.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record, null, 2));
