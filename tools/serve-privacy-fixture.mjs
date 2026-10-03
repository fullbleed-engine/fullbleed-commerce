// SPDX-License-Identifier: MIT
// Isolated browser fixture: real production routes/SDK, synthetic signed sessions.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { recoveryFixtureEnvironment } from './recovery-fixture.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'shopify/app');
Object.assign(process.env, {
  ...await recoveryFixtureEnvironment(root, 'privacy-browser'),
  DATABASE_URL: `file:${resolve(root, 'target/privacy-browser.sqlite').replaceAll('\\', '/')}`,
  NODE_ENV: 'production', SHOPIFY_API_KEY: 'synthetic-test-api-key', SHOPIFY_API_SECRET: 'synthetic-webhook-test-secret',
  FULLBLEED_PRIVACY_KEY: 'ab'.repeat(32), SHOPIFY_APP_URL: 'http://127.0.0.1:9484', SCOPES: 'read_orders', FULLBLEED_DEV_STORE: '', OPT_OUT_INSTRUMENTATION: 'true',
});
const migrations = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: app, env: process.env, encoding: 'utf8', windowsHide: true });
if (migrations.status !== 0) throw new Error('Synthetic browser database migration failed.');
const require = createRequire(resolve(app, 'package.json'));
const { PrismaClient } = require('@prisma/client');
const { createRequestHandler } = require('react-router');
const db = new PrismaClient();
const { createPrivacyService, parsePrivacyPayload } = await import('../shopify/privacy.js');
const shop = 'synthetic-privacy.myshopify.com';
await db.privacyRequest.deleteMany(); await db.session.deleteMany(); await db.automationSettings.deleteMany(); await db.recoveryReceipt.deleteMany();
await db.session.create({ data: { id: `offline_${shop}`, shop, state: '', isOnline: false, accessToken: 'synthetic-token', scope: 'read_orders' } });
await db.automationSettings.create({ data: { shop } });
await db.automationJob.create({ data: { shop, runId: 'synthetic-browser-run', handle: 'create-order-summary-link', orderId: 'gid://shopify/Order/820982911946154508', kind: 'order-summary', requestHash: 'synthetic-hash', ttlHours: 24, retryDeadline: new Date(), status: 'ready', downloads: 2 } });
let at = Date.now() - 31 * 24 * 3600000;
const service = createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY, now: () => new Date(at) });
const ids = [];
for (const requestId of ['90001', '90002']) {
  ids.push(await service.accept(parsePrivacyPayload(Buffer.from(JSON.stringify({ shop_domain: shop, shop_id: 1, customer: { email: `synthetic-${requestId}@example.invalid` }, orders_requested: ['820982911946154508'], data_request: { id: requestId } })), shop, 'CUSTOMERS_DATA_REQUEST')));
  at = Date.now();
}
// Privacy handlers must work without contacting Shopify Admin or billing APIs.
globalThis.fetch = () => { throw new Error('No outbound API requests are allowed in this synthetic fixture.'); };
const handler = createRequestHandler(await import('../shopify/app/build/server/index.js'), 'production');
const assets = resolve(app, 'build/client');
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1:9484');
    if (url.pathname.startsWith('/assets/')) {
      const file = resolve(assets, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(assets + sep)) { outgoing.writeHead(404); outgoing.end(); return; }
      const bytes = readFileSync(file);
      outgoing.writeHead(200, { 'Content-Type': extname(file) === '.js' ? 'text/javascript' : 'text/css' }); outgoing.end(bytes); return;
    }
    const chunks = []; let size = 0;
    for await (const chunk of incoming) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('Fixture request too large.'); chunks.push(chunk); }
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Synthetic fixture request failed.'); }
});
server.listen(9484, '127.0.0.1', () => {
  mkdirSync(resolve(root, 'target'), { recursive: true });
  writeFileSync(resolve(root, 'target/privacy-browser-fixture.json'), JSON.stringify({ shop, ids, origin: 'http://127.0.0.1:9484', pid: process.pid }));
  console.log('Synthetic privacy browser fixture ready on 127.0.0.1:9484.');
});
