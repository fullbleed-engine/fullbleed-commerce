// SPDX-License-Identifier: MIT
// Synthetic container checks. Creates and removes only its uniquely named resources.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { createHmac, randomUUID } from 'node:crypto';

const image = process.argv[2] || 'fullbleed-commerce:check';
const docker = process.env.DOCKER_BIN || 'docker';
const name = `fullbleed-check-${process.pid}-${Date.now()}`;
const volume = `${name}-data`;
const recoveryVolume = `${name}-recovery`;
const recoveryEnv = ['-e', 'FULLBLEED_RECOVERY_DIRECTORY=/recovery', '-e', `FULLBLEED_RECOVERY_KEY=${'ef'.repeat(32)}`, '-e', `FULLBLEED_RECOVERY_DATASET=${randomUUID()}`];
const checks = [];
let containerCreated = false;
let volumeCreated = false;
let recoveryVolumeCreated = false;
function run(args, options = {}) {
  const result = spawnSync(docker, args, { encoding: 'utf8', timeout: 60000, windowsHide: true, ...options });
  assert.equal(result.status, 0, `${args[0]} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function passed(name) { checks.push({ name, passed: true }); console.log(`container: ${name}`); }
function script(source) { return run(['exec', '--user', 'node', name, 'node', '--input-type=module', '-e', source]); }
async function start() {
  run(['run', '-d', '--name', name, '--user', '0', '--cpus', '0.5', '--memory', '512m',
    '--mount', `type=volume,src=${volume},dst=/data,volume-nocopy`, '-p', '127.0.0.1::3000',
    '--mount', `type=volume,src=${recoveryVolume},dst=/recovery,volume-nocopy`, ...recoveryEnv,
    '-e', 'SHOPIFY_API_KEY=synthetic-test-api-key', '-e', 'SHOPIFY_API_SECRET=synthetic-container-test-secret',
    '-e', `FULLBLEED_PRIVACY_KEY=${'ab'.repeat(32)}`, '-e', 'SHOPIFY_APP_URL=http://localhost:3000',
    '-e', 'SCOPES=read_orders', image]);
  containerCreated = true;
  const port = JSON.parse(run(['inspect', name]))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort;
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
      ready = response.status === 200 && (await response.json()).status === 'ok';
    } catch { /* Wait for migrations and the server to start. */ }
    if (ready) break;
    await setTimeout(500);
  }
  assert.ok(ready, 'Container did not become ready.');
  return origin;
}
try {
  assert.equal(run(['run', '--rm', image, 'id', '-u']), '1000');
  passed('default image user is unprivileged');
  const missingVolume = spawnSync(docker, ['run', '--rm', '-e', 'RAILWAY_ENVIRONMENT_ID=synthetic', image], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(missingVolume.status, 1);
  assert.match(missingVolume.stderr, /requires the persistent volume at \/data/);
  passed('Railway startup refuses an absent persistent mount');
  const missingRecovery = spawnSync(docker, ['run', '--rm', '--tmpfs', '/data:uid=1000,gid=1000,mode=0700', image], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(missingRecovery.status, 1);
  assert.match(missingRecovery.stderr, /Fullbleed recovery failed/);
  passed('startup refuses unconfigured independent recovery storage');
  run(['volume', 'create', volume]); volumeCreated = true;
  run(['volume', 'create', recoveryVolume]); recoveryVolumeCreated = true;
  run(['run', '--rm', '--user', '0', '--entrypoint', 'sh', '--mount',
    `type=volume,src=${recoveryVolume},dst=/recovery,volume-nocopy`, ...recoveryEnv, image,
    '-c', 'chown 1000:1000 /recovery && chmod 700 /recovery && exec gosu node node scripts/recovery.mjs init']);
  assert.equal(run(['run', '--rm', '--user', '0', '--entrypoint', 'stat', '--mount',
    `type=volume,src=${volume},dst=/data,volume-nocopy`, image, '-c', '%u', '/data']), '0');
  let origin = await start();
  passed('fresh root-owned volume migrates and passes HTTP readiness under resource limits');
  script(String.raw`
    import assert from 'node:assert/strict';
    import { statSync, readdirSync, readFileSync } from 'node:fs';
    for (const path of ['/data', '/data/commerce.sqlite']) {
      const stat = statSync(path);
      assert.equal(stat.uid, 1000);
      assert.equal(stat.mode & 0o077, 0);
    }
    const servers = readdirSync('/proc').filter(pid => /^\d+$/.test(pid)).filter(pid => {
      try { return readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0').some(arg => arg.endsWith('/react-router-serve')); }
      catch { return false; }
    });
    assert.ok(servers.length > 0, 'Find the actual HTTP server process.');
    for (const pid of servers) assert.match(readFileSync('/proc/' + pid + '/status', 'utf8'), /^Uid:\s+1000\s+1000\s+1000\s+1000$/m);
  `);
  passed('application process and private database remain owned by node');
  let response = await fetch(`${origin}/privacy`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Fullbleed Commerce privacy/);
  response = await fetch(`${origin}/app/pdf?order=gid://shopify/Order/1`);
  // Shopify rejects Node's bot user agent before its browser auth handshake.
  assert.equal(response.status, 410);
  response = await fetch(`${origin}/app/pdf?order=gid://shopify/Order/1`, { headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  } });
  assert.match(response.headers.get('content-type'), /text\/html/);
  const authPage = await response.text();
  assert.match(authPage, /shopifycloud\/app-bridge\.js/);
  assert.doesNotMatch(authPage, /%PDF-/);
  response = await fetch(`${origin}/webhooks/privacy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 400);
  response = await fetch(`${origin}/webhooks/privacy`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Shopify-Topic': 'shop/redact',
    'X-Shopify-Shop-Domain': 'synthetic-container.myshopify.com',
    'X-Shopify-API-Version': '2026-10', 'X-Shopify-Hmac-Sha256': 'invalid',
    'X-Shopify-Webhook-Id': '00000000-0000-4000-8000-000000000001',
  }, body: JSON.stringify({ shop_domain: 'synthetic-container.myshopify.com', shop_id: 1 }) });
  assert.equal(response.status, 401);
  passed('public privacy page works and unauthenticated documents and webhooks are denied');
  script(`
    import { PrismaClient } from '@prisma/client';
    const db = new PrismaClient();
    await db.brand.create({ data: { shop: 'synthetic-container.myshopify.com', sellerName: 'Synthetic persisted branding' } });
    await db.automationSettings.create({ data: { shop: 'synthetic-container.myshopify.com', jobs: { create: {
      runId: 'synthetic-persisted-run', handle: 'create-order-summary-link', orderId: 'gid://shopify/Order/1',
      kind: 'order-summary', requestHash: 'synthetic-hash', ttlHours: 24, retryDeadline: new Date(Date.now() + 3600000)
    } } } });
    await db.$disconnect();
  `);
  run(['stop', '--time', '10', name]);
  run(['rm', name]); containerCreated = false;
  origin = await start();
  script(`
    import assert from 'node:assert/strict';
    import { PrismaClient } from '@prisma/client';
    const db = new PrismaClient();
    const shop = 'synthetic-container.myshopify.com';
    assert.equal((await db.brand.findUniqueOrThrow({ where: { shop } })).sellerName, 'Synthetic persisted branding');
    assert.equal((await db.automationJob.findUniqueOrThrow({ where: { shop_runId: { shop, runId: 'synthetic-persisted-run' } } })).status, 'pending');
    await db.$disconnect();
  `);
  passed('branding and pending jobs survive container replacement and repeat migration');
  script(`
    import { PrismaClient } from '@prisma/client';
    import { createPrivacyService, parsePrivacyPayload } from '../../shopify/privacy.js';
    const db = new PrismaClient();
    const shop = 'synthetic-container.myshopify.com';
    await db.session.create({ data: { id: 'offline_' + shop, shop, state: '', isOnline: false, accessToken: 'synthetic-container-token' } });
    const input = parsePrivacyPayload(Buffer.from(JSON.stringify({ shop_domain: shop, shop_id: 1, customer: { email: 'synthetic-container@example.invalid' }, data_request: { id: 1 }, orders_requested: [1] })), shop, 'CUSTOMERS_DATA_REQUEST');
    await createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY }).accept(input);
    await db.$disconnect();
  `);
  const saved = JSON.parse(run(['exec', '--user', 'node', name, 'node', 'scripts/recovery.mjs', 'backup'])).result;
  const eraseBody = JSON.stringify({ shop_domain: 'synthetic-container.myshopify.com', shop_id: 1, customer: { email: 'synthetic-container@example.invalid' }, orders_to_redact: [] });
  response = await fetch(`${origin}/webhooks/privacy`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Shopify-Topic': 'customers/redact', 'X-Shopify-Shop-Domain': 'synthetic-container.myshopify.com',
    'X-Shopify-API-Version': '2026-10', 'X-Shopify-Webhook-Id': randomUUID(), 'X-Shopify-Hmac-Sha256': createHmac('sha256', 'synthetic-container-test-secret').update(eraseBody).digest('base64'),
  }, body: eraseBody });
  assert.equal(response.status, 204);
  const restored = JSON.parse(run(['exec', '--user', 'node', name, 'node', 'scripts/recovery.mjs', 'restore', '--backup', saved.id, '--output', '/data/restored-check'])).result;
  assert.equal(restored.replay.applied, 1);
  assert.equal(restored.sourceSha256, saved.sha256);
  script(`
    import assert from 'node:assert/strict';
    import { PrismaClient } from '@prisma/client';
    const restored = new PrismaClient({ datasources: { db: { url: 'file:/data/restored-check/commerce.sqlite' } } });
    assert.equal(await restored.session.count(), 0);
    assert.equal((await restored.privacyRequest.findFirst()).snapshot, null);
    assert.equal((await restored.automationJob.findFirst()).orderId, '');
    assert.equal((await restored.brand.findFirst()).sellerName, 'Synthetic persisted branding');
    assert.equal(await restored.automationSettings.count({ where: { enabled: true } }), 0);
    await restored.$disconnect();
    const source = new PrismaClient();
    await source.privacyRequest.deleteMany(); await source.session.deleteMany();
    await source.brand.deleteMany(); await source.automationSettings.deleteMany();
    await source.$disconnect();
  `);
  passed('encrypted backup restores offline and replays later signed customer erasure');
  const monitor = JSON.parse(run(['exec', '--user', 'node', name, 'node', 'scripts/privacy-status.mjs']));
  assert.equal(monitor.pending, 0);
  passed('privacy operator command runs in the production image');
  mkdirSync('output/container', { recursive: true });
  writeFileSync('output/container/verification.json', JSON.stringify({ checkedAt: new Date().toISOString(),
    imageId: run(['image', 'inspect', image, '--format', '{{.Id}}']), cpuLimit: 0.5, memoryBytes: 536870912,
    syntheticOnly: true, checks }, null, 2) + '\n');
} catch (error) {
  if (containerCreated) console.error(run(['logs', name]));
  throw error;
} finally {
  if (containerCreated) run(['rm', '-f', name]);
  if (volumeCreated) run(['volume', 'rm', volume]);
  if (recoveryVolumeCreated) run(['volume', 'rm', recoveryVolume]);
}
