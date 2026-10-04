// SPDX-License-Identifier: MIT
// Synthetic API boundaries; real built routes, SDK authentication and rendering.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { recoveryFixtureEnvironment } from './recovery-fixture.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), app = resolve(root, 'shopify/app');
const origin = 'http://127.0.0.1:9486', shop = 'synthetic-plans.myshopify.com';
Object.assign(process.env, { ...await recoveryFixtureEnvironment(root, 'plans-browser'), DATABASE_URL: `file:${resolve(root, 'target/plans-browser.sqlite').replaceAll('\\', '/')}`,
  NODE_ENV: 'production', SHOPIFY_API_KEY: 'synthetic-test-api-key', SHOPIFY_API_SECRET: 'synthetic-webhook-test-secret', FULLBLEED_PRIVACY_KEY: 'ab'.repeat(32), SHOPIFY_APP_URL: origin,
  SCOPES: 'read_orders', FULLBLEED_DEV_STORE: '', OPT_OUT_INSTRUMENTATION: 'true', SHOPIFY_PARTNER_ORG_ID: '1', SHOPIFY_PARTNER_APP_ID: 'gid://shopify/App/1', SHOPIFY_PARTNER_API_ACCESS_TOKEN: 'synthetic-partner-token', SHOPIFY_PLAN_HANDLES: 'studio,scale', SHOPIFY_APP_HANDLE: 'fullbleed-commerce',
});
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: app, env: process.env, encoding: 'utf8', windowsHide: true });
if (migration.status !== 0) throw new Error('Synthetic plan fixture migration failed.');
const require = createRequire(resolve(app, 'package.json')), { PrismaClient } = require('@prisma/client'), { createRequestHandler } = require('react-router');
const db = new PrismaClient();
await db.usagePeriod.deleteMany(); await db.session.deleteMany(); await db.automationSettings.deleteMany(); await db.recoveryReceipt.deleteMany();
await db.session.create({ data: { id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-token', scope: 'read_orders' } });
let trialEndsAt = new Date(Date.now() + 7 * 86400000);
await db.usagePeriod.create({ data: { shop, key: `trial:${trialEndsAt.toISOString()}`, startsAt: null, endsAt: trialEndsAt, used: 249 } });
let handle = 'studio';
const money = amount => ({ presentmentMoney: { amount, currencyCode: 'USD' } });
globalThis.fetch = async (resource, init) => {
  const request = new Request(resource, init), url = new URL(request.url), body = await request.json();
  if (url.origin === 'https://partners.shopify.com') return Response.json({ data: { activeSubscription: { shop: { id: 'gid://shopify/Shop/1', myshopifyDomain: shop }, billingPeriod: 'EVERY_30_DAYS', currentBillingCycle: null, items: [{ handle }], cancelAtEndOfCycle: false, trialEndsAt: trialEndsAt.toISOString(), pendingUpdate: null } } });
  if (url.origin !== `https://${shop}`) throw new Error('Only synthetic API calls are allowed.');
  if (body.query.includes('FullbleedShop')) return Response.json({ data: { shop: { id: 'gid://shopify/Shop/1', name: 'Cedar Studio', myshopifyDomain: shop, ianaTimezone: 'America/Chicago', plan: { partnerDevelopment: true } } } });
  if (body.query.includes('FullbleedRecentOrders')) return Response.json({ data: { orders: { nodes: [1, 2].map(id => ({ id: `gid://shopify/Order/${id}`, name: `#100${id}`, displayFinancialStatus: 'PAID' })) } } });
  if (!body.query.includes('FullbleedOrder')) throw new Error('Unexpected synthetic operation.');
  return Response.json({ data: { order: { id: body.variables.id, name: `#100${body.variables.id.split('/').at(-1)}`, createdAt: '2026-10-02T14:00:00Z', cancelledAt: null, displayFinancialStatus: 'PAID', presentmentCurrencyCode: 'USD', edited: false, taxesIncluded: false,
    currentSubtotalPriceSet: money('90.00'), currentShippingPriceSet: money('0.00'), currentTotalTaxSet: money('4.50'), currentTotalPriceSet: money('94.50'), totalRefundedSet: money('0.00'),
    billingAddress: { name: 'Synthetic Recipient', address1: '42 Example Street' }, shippingAddress: { name: 'Synthetic Recipient', address1: '42 Example Street' }, lineItems: { pageInfo: { hasNextPage: false }, nodes: [{ name: 'Linen notebook', sku: 'NBK', quantity: 1, discountedTotalSet: money('90.00') }] },
  } } });
};
const serverBuildSha256 = createHash('sha256').update(readFileSync(resolve(app, 'build/server/index.js'))).digest('hex');
const handler = createRequestHandler(await import('../shopify/app/build/server/index.js'), 'production'), assets = resolve(app, 'build/client');
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    if (url.pathname === '/__fixture/scale' && incoming.method === 'POST') { handle = 'scale'; trialEndsAt = new Date(trialEndsAt.valueOf() + 4 * 60000); outgoing.writeHead(204); outgoing.end(); return; }
    if (url.pathname.startsWith('/assets/')) {
      const file = resolve(assets, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(assets + sep)) { outgoing.writeHead(404); outgoing.end(); return; }
      outgoing.writeHead(200, { 'Content-Type': extname(file) === '.js' ? 'text/javascript' : 'text/css' }); outgoing.end(readFileSync(file)); return;
    }
    const chunks = []; let size = 0;
    for await (const chunk of incoming) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('Too large.'); chunks.push(chunk); }
    const response = await handler(new Request(url, { method: incoming.method, headers: incoming.headers, ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Synthetic plan fixture failed.'); }
});
server.listen(9486, '127.0.0.1', () => {
  writeFileSync(resolve(root, 'target/plans-browser-fixture.json'), JSON.stringify({ shop, origin, pid: process.pid, serverBuildSha256 }));
  console.log('Synthetic plans browser fixture ready on 127.0.0.1:9486.');
});
