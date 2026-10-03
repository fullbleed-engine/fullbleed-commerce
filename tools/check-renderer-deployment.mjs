// SPDX-License-Identifier: MIT
// Real Linux containers and native WordPress HTTP/TLS. Synthetic data only.
// Requires built ZIPs, root dependencies, Docker Engine and Docker Compose v2.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { unzipSync } from 'fflate';
import { createClient } from '../automation/create-client.mjs';
import { renderOrder } from '../src/node.js';

const project = `fullbleed-renderer-check-${process.pid}-${Date.now()}`;
const output = resolve('output/renderer-deployment');
const target = resolve('target');
mkdirSync(output, { recursive: true });
mkdirSync(target, { recursive: true });
const scratch = mkdtempSync(join(target, 'renderer-deployment-'));
const connection = createClient(join(scratch, 'connection'), 'synthetic-store');
const env = {
  ...process.env,
  FULLBLEED_RENDERER_IMAGE: `${project}:test`,
  FULLBLEED_PROXY_IMAGE: `${project}:proxy`,
  FULLBLEED_CLIENTS_FILE: connection.clientsFile,
  FULLBLEED_CADDYFILE: resolve('tools/renderer-fixture/Caddyfile'),
  FULLBLEED_RENDERER_HOST: 'renderer.example.test',
  FULLBLEED_ACME_EMAIL: 'operator@example.test',
  FULLBLEED_LISTEN_ADDRESS: '127.0.0.1', FULLBLEED_HTTP_PORT: '0', FULLBLEED_HTTPS_PORT: '0',
};
const docker = process.env.DOCKER_BIN || 'docker';
const composeArgs = ['compose', '--project-name', project, '-f', resolve('automation/compose.yaml')];
const checks = [];
const containers = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (args, options = {}) => {
  const result = spawnSync(docker, args, { encoding: 'utf8', env, timeout: 90000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${args[0]} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout.trim();
};
const compose = (args, options = {}) => run([...composeArgs, ...args], options);
const passed = name => { checks.push({ name, passed: true }); console.log(`renderer-deployment: ${name}`); };
const inspect = name => JSON.parse(run(['inspect', name]))[0];
const copyOut = (container, from, to) => run(['cp', `${container}:${from}`, to]);
const php = (container, file, args = []) => JSON.parse(run(['exec', '--user', 'www-data', container, 'php', file, ...args]));
async function waitUntil(fn, label) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (fn()) return;
    await setTimeout(1000);
  }
  throw new Error(`Timed out waiting for ${label}; the current container is not restarted.`);
}
function extract(bytes, directory, prefix) {
  const entries = Object.entries(unzipSync(bytes));
  assert.ok(entries.length > 0 && entries.length < 30000);
  let size = 0;
  for (const [name, data] of entries) {
    assert.ok(name.startsWith(`${prefix}/`) && !name.includes('\\') && !name.split('/').includes('..'));
    const destination = resolve(directory, name);
    assert.ok(destination.startsWith(resolve(directory) + sep));
    size += data.length; assert.ok(size < 512 * 1024 * 1024);
    if (name.endsWith('/')) mkdirSync(destination, { recursive: true });
    else { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, data); }
  }
  return entries.filter(([name]) => !name.endsWith('/')).map(([name, bytes]) => ({ name, sha256: hash(bytes) }));
}
let composeStarted = false;
try {
  const configuration = JSON.parse(compose(['config', '--format', 'json']));
  assert.equal(configuration.services.renderer.read_only, true);
  assert.equal(configuration.networks.renderer_private.internal, true);
  assert.ok(!configuration.services.renderer.ports?.length);
  passed('deployment configuration publishes only the TLS proxy and isolates renderer egress');
  composeStarted = true;
  compose(['up', '-d', '--build', '--wait', '--wait-timeout', '90'], { timeout: 600000 });
  const renderer = compose(['ps', '-q', 'renderer']);
  const proxy = compose(['ps', '-q', 'proxy']);
  assert.match(run(['exec', proxy, 'caddy', 'version']), /^v2\.11\.7\b/);
  const details = inspect(renderer);
  assert.equal(details.Config.User, 'node');
  assert.equal(details.HostConfig.ReadonlyRootfs, true);
  assert.equal(details.HostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(details.HostConfig.NanoCpus, 500000000);
  assert.ok(details.HostConfig.CapDrop.includes('ALL'));
  assert.ok(details.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
  assert.equal(details.State.Health.Status, 'healthy');
  assert.ok(details.Mounts.some(mount => mount.Destination === '/run/secrets/renderer_clients' && !mount.RW));
  assert.ok(!details.Mounts.some(mount => mount.Source === connection.tokenFile));
  passed('renderer starts as an unprivileged user with read-only files, health checks and enforced resource limits');
  const writeDenied = spawnSync(docker, ['exec', renderer, 'node', '-e', "require('node:fs').writeFileSync('/renderer/should-not-exist','x')"], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(writeDenied.status, 0);
  passed('running renderer cannot write into its application directory');
  const productionConfig = run(['run', '--rm', '-e', 'FULLBLEED_RENDERER_HOST=renderer.example.test', '-e', 'FULLBLEED_ACME_EMAIL=operator@example.test', '--mount', `type=bind,src=${resolve('automation/Caddyfile')},dst=/etc/caddy/Caddyfile,readonly`, configuration.services.proxy.image, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile', '--validate']);
  assert.equal(JSON.parse(productionConfig).apps.http.servers.srv0.routes[0].match[0].host[0], 'renderer.example.test');
  passed('public-certificate Caddy configuration validates without requesting a certificate');

  const network = configuration.networks.renderer_private.name;
  assert.equal(JSON.parse(run(['network', 'inspect', network]))[0].Internal, true);
  const database = `${project}-database`;
  const wordpress = `${project}-wordpress`;
  const images = {
    wordpress: 'wordpress:7.1.2-php8.3-apache@sha256:4abf7a450ee477dde967584f8174d7e03221d224c4971a0c38d84e7254426e64',
    database: 'mariadb:11.8@sha256:6422478cb8e159f080fb1d8ccf65101e26fe51385787fde7d16c3b165a331f15',
  };
  run(['pull', images.database], { timeout: 180000 });
  run(['pull', images.wordpress], { timeout: 180000 });
  containers.push(database);
  run(['run', '-d', '--name', database, '--network', network, '--network-alias', 'database',
    '--tmpfs', '/var/lib/mysql:rw,size=512m', '-e', 'MARIADB_ROOT_PASSWORD=synthetic-root-only', '-e', 'MARIADB_DATABASE=wordpress', '-e', 'MARIADB_USER=wordpress', '-e', 'MARIADB_PASSWORD=synthetic-database-only', images.database]);
  await waitUntil(() => spawnSync(docker, ['exec', database, 'healthcheck.sh', '--connect', '--innodb_initialized'], { stdio: 'ignore' }).status === 0, 'MariaDB');
  containers.push(wordpress);
  run(['run', '-d', '--name', wordpress, '--network', network, '-e', 'FULLBLEED_NATIVE_FIXTURE=1',
    '-e', 'WORDPRESS_DB_HOST=database', '-e', 'WORDPRESS_DB_USER=wordpress', '-e', 'WORDPRESS_DB_PASSWORD=synthetic-database-only', '-e', 'WORDPRESS_DB_NAME=wordpress',
    '-e', "WORDPRESS_CONFIG_EXTRA=define('WP_HOME','http://store.example.test');define('WP_SITEURL','http://store.example.test');define('WP_HTTP_BLOCK_EXTERNAL',true);define('WP_ACCESSIBLE_HOSTS','renderer.example.test');define('DISABLE_WP_CRON',true);", images.wordpress]);
  await waitUntil(() => spawnSync(docker, ['exec', wordpress, 'test', '-f', '/var/www/html/wp-config.php'], { stdio: 'ignore' }).status === 0, 'WordPress files');
  const plugins = join(scratch, 'plugins'); mkdirSync(plugins);
  const packages = JSON.parse(readFileSync('dist/packages.json', 'utf8'));
  const manifest = [];
  for (const item of packages) {
    const bytes = readFileSync(`dist/${item.filename}`); assert.equal(hash(bytes), item.sha256);
    manifest.push(...extract(bytes, plugins, item.filename.startsWith('fullbleed-commerce-pro-') ? 'fullbleed-commerce-pro' : 'fullbleed-commerce'));
  }
  const wooUrl = 'https://downloads.wordpress.org/plugin/woocommerce.11.1.2.zip';
  const response = await fetch(wooUrl, { signal: AbortSignal.timeout(60000) }); assert.equal(response.status, 200);
  const wooBytes = Buffer.from(await response.arrayBuffer());
  extract(wooBytes, plugins, 'woocommerce');
  run(['cp', `${plugins}/.`, `${wordpress}:/var/www/html/wp-content/plugins/`]);
  run(['cp', resolve('tools/renderer-fixture/bootstrap.php'), `${wordpress}:/tmp/fullbleed-bootstrap.php`]);
  run(['cp', resolve('tools/renderer-fixture/check.php'), `${wordpress}:/tmp/fullbleed-check.php`]);
  run(['cp', connection.tokenFile, `${wordpress}:/tmp/wordpress-token.txt`]);
  run(['exec', wordpress, 'chown', 'www-data:www-data', '/tmp/wordpress-token.txt']);
  const caFile = join(scratch, 'root.crt');
  copyOut(proxy, '/data/caddy/pki/authorities/local/root.crt', caFile);
  run(['cp', caFile, `${wordpress}:/tmp/fullbleed-root.crt`]);
  // Caddy stores its public CA certificate with private storage permissions.
  // WordPress needs read access to this certificate; no CA private key is copied.
  run(['exec', wordpress, 'chmod', '0644', '/tmp/fullbleed-root.crt']);
  assert.equal(php(wordpress, '/tmp/fullbleed-bootstrap.php').installed, true);
  assert.equal(php(wordpress, '/tmp/fullbleed-bootstrap.php', ['commerce']).installed, true);
  writeFileSync(join(scratch, 'manifest.json'), JSON.stringify(manifest));
  run(['cp', join(scratch, 'manifest.json'), `${wordpress}:/tmp/fullbleed-manifest.json`]);
  assert.equal(run(['exec', wordpress, 'php', '-r', "$items=json_decode(file_get_contents('/tmp/fullbleed-manifest.json'),true);foreach($items as $item){if(hash_file('sha256','/var/www/html/wp-content/plugins/'.$item['name'])!==$item['sha256'])exit(1);}echo count($items);"]), String(manifest.length));
  passed('fresh native WordPress and WooCommerce install every exact base and Pro ZIP entry');
  const phases = [];
  function phase(mode) {
    let record;
    try { record = php(wordpress, '/tmp/fullbleed-check.php', [mode]); }
    catch (error) {
      for (const name of ['checks.json', 'mail.eml', 'summary.pdf', 'packing.pdf']) {
        const file = `/tmp/fullbleed-native-${name}`;
        if (spawnSync(docker, ['exec', wordpress, 'test', '-f', file], { stdio: 'ignore' }).status === 0) copyOut(wordpress, file, join(output, `failed-${mode}-${name}`));
      }
      throw error;
    }
    assert.ok(record.checks.length > 0 && record.checks.every(item => item.passed));
    phases.push(record);
    for (const item of record.checks) passed(`${mode}: ${item.name}`);
    if (mode !== 'revoked') {
      assert.equal(run(['exec', wordpress, 'php', '-r', "$paths=json_decode(file_get_contents('/tmp/fullbleed-native-attachment-paths.json'),true);foreach($paths as $path)if(file_exists($path))exit(1);echo 'removed';"]), 'removed');
      copyOut(wordpress, '/tmp/fullbleed-native-mail.eml', join(output, `${mode}.eml`));
    }
  }
  phase('render');
  copyOut(wordpress, '/tmp/fullbleed-native-summary.pdf', join(output, 'https-summary.pdf'));
  copyOut(wordpress, '/tmp/fullbleed-native-packing.pdf', join(output, 'https-packing.pdf'));
  const orderFile = join(scratch, 'order.json'); copyOut(wordpress, '/tmp/fullbleed-native-order.json', orderFile);
  const order = JSON.parse(readFileSync(orderFile, 'utf8'));
  const documents = [];
  for (const [kind, filename] of [['order-summary', 'https-summary.pdf'], ['packing-slip', 'https-packing.pdf']]) {
    const local = await renderOrder(order, { kind, previewDpi: 100 });
    const actual = readFileSync(join(output, filename));
    assert.deepEqual(actual, Buffer.from(local.pdf));
    assert.equal(local.missingGlyphs, 0);
    assert.ok(local.previews.length > 0);
    for (const [index, png] of local.previews.entries()) writeFileSync(join(output, `${kind}-${index + 1}.png`), png);
    documents.push({ filename, sha256: hash(actual), bytes: actual.length, pages: local.pages, missingGlyphs: local.missingGlyphs, matchesDirectNodeRenderer: true });
  }
  const summaryBase64 = readFileSync(join(output, 'https-summary.pdf')).toString('base64');
  assert.ok(readFileSync(join(output, 'render.eml'), 'utf8').replace(/\s/g, '').includes(summaryBase64));
  passed('TLS PDFs match direct Node rendering and complete summary bytes reach the captured email');
  passed('request-owned private attachment files are removed after mail processing');
  compose(['stop', 'renderer']);
  phase('outage');
  compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90']);
  phase('recovery');
  const rotated = createClient(join(scratch, 'rotated'), 'synthetic-store');
  env.FULLBLEED_CLIENTS_FILE = rotated.clientsFile;
  compose(['up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '90', 'renderer']);
  phase('revoked');
  run(['cp', rotated.tokenFile, `${wordpress}:/tmp/wordpress-token.txt`]);
  run(['exec', wordpress, 'chown', 'www-data:www-data', '/tmp/wordpress-token.txt']);
  phase('rotated');
  const logs = compose(['logs', '--no-color']);
  for (const tokenFile of [connection.tokenFile, rotated.tokenFile]) assert.ok(!logs.includes(readFileSync(tokenFile, 'utf8').trim()));
  for (const value of ['Alex', 'Morgan', '42 Example Street', 'LIN-MOSS']) assert.ok(!logs.includes(value));
  passed('deployment logs contain neither raw renderer tokens nor synthetic order fields');
  const evidence = ['https-summary.pdf', 'https-packing.pdf', 'render.eml', 'outage.eml', 'recovery.eml', 'rotated.eml'].map(filename => ({ file: `output/renderer-deployment/${filename}`, sha256: hash(readFileSync(join(output, filename))) }));
  const result = { checkedAt: new Date().toISOString(), syntheticOnly: true, transport: 'Native WordPress/PHP cURL over real TLS to Caddy and the unmodified renderer container. Local fixture CA trusted explicitly; private Docker hostname permitted only in the fixture. No pre_http_request response substitution. PHPMailer MIME is captured without sending.', packages, images: { ...images, proxy: configuration.services.proxy.image, rendererImageId: inspect(compose(['ps', '-q', 'renderer'])).Image }, woocommerceArchive: { url: wooUrl, sha256: hash(wooBytes) }, checks, phases, documents, evidence, limitations: ['Local TLS issuer only; public DNS, ACME issuance and a merchant host remain deployment checks.', 'No production email provider, managed hosting, paid entitlements or merchant data used.', 'The renderer remains one process with in-memory capacity limits; this is not metered SaaS or a high-availability claim.'] };
  writeFileSync(join(output, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ passed: checks.length, record: 'output/renderer-deployment/verification.json' }));
} catch (error) {
  writeFileSync(join(output, 'failure.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), checks, error: error.message.slice(0,3000) }, null, 2)}\n`);
  throw error;
} finally {
  // Resource names and paths are owned by this invocation. Never prune globally.
  assert.ok(project.startsWith('fullbleed-renderer-check-'));
  for (const name of containers.reverse()) run(['rm', '-f', '-v', name]);
  if (composeStarted) compose(['down', '--volumes', '--remove-orphans'], { timeout: 90000 });
  assert.equal(dirname(resolve(scratch)), target);
  assert.ok(basename(scratch).startsWith('renderer-deployment-'));
  rmSync(scratch, { recursive: true, force: true });
}
