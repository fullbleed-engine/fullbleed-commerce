// SPDX-License-Identifier: MIT
// Real WordPress HTTP authorization against synthetic HPOS or legacy orders.
import { runCLI } from '@wp-playground/cli';
import { resolve } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { createRenderer } from '../automation/renderer.js';
import { starterTemplate } from '../src/documents.js';
import { pluginMetadata } from './plugin-metadata.mjs';

const hpos = process.argv.includes('--hpos');
const packages = process.argv.includes('--packages');
const serve = process.argv.includes('--serve');
const port = hpos ? 9482 : 9483;
const base = `http://127.0.0.1:${port}`;
const stem = `customer-${hpos ? 'hpos' : 'legacy'}`;
const checks = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (name, ok) => { assert.ok(ok, name); checks.push({ name, passed: true }); console.log(`${name}: passed`); };
const pluginNames = ['fullbleed-commerce', 'fullbleed-commerce-pro'];
const packageRecords = packages ? JSON.parse(await readFile('dist/packages.json', 'utf8')) : [];
const installSteps = [];
for (const name of pluginNames) {
  const { filename } = await pluginMetadata(name);
  installSteps.push(packages
    ? { step: 'installPlugin', pluginData: { resource: 'literal', name: `${name}.zip`, contents: new Uint8Array(await readFile(`dist/${filename}`)) }, options: { activate: true } }
    : { step: 'activatePlugin', pluginPath: `${name}/${name}.php` });
}
const site = await runCLI({
  command: 'server', php: '8.3', wp: 'latest', port, login: false, workers: 1, quiet: true,
  'define-bool': { WP_HTTP_BLOCK_EXTERNAL: true, DISABLE_WP_CRON: true }, 'site-url': base,
  mount: packages ? [] : pluginNames.map(name => ({ hostPath: resolve('wordpress', name), vfsPath: `/wordpress/wp-content/plugins/${name}` })),
  blueprint: { steps: [
    { step: 'installPlugin', pluginData: { resource: 'wordpress.org/plugins', slug: 'woocommerce' }, options: { activate: true } },
    { step: 'runPHP', code: `<?php require '/wordpress/wp-load.php'; update_option('woocommerce_custom_orders_table_enabled', '${hpos ? 'yes' : 'no'}');` },
    ...installSteps,
    { step: 'runPHP', code: await readFile('tools/seed-wordpress.php', 'utf8') },
  ] },
});
await new Promise((done, reject) => site.server.close(error => error ? reject(error) : done()));
await new Promise((done, reject) => { site.server.once('error', reject); site.server.listen(port, '127.0.0.1', done); });
const php = async code => {
  const result = await site.playground.run({ code: `<?php require '/wordpress/wp-load.php'; ${code}` });
  assert.equal(result.exitCode, 0, result.errors); assert.equal(result.errors, '', result.errors);
  return result.text;
};
const phpJson = async code => JSON.parse(await php(`echo wp_json_encode(${code});`));
const phpValue = value => `json_decode(base64_decode('${Buffer.from(JSON.stringify(value)).toString('base64')}'), true)`;
function client() {
  const cookies = new Map();
  return async (path, data) => {
    const url = new URL(path, base);
    assert.equal(url.origin, base, 'Fixture requests stay on loopback');
    const response = await fetch(url, { redirect: 'manual', headers: { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }, ...(data ? { method: 'POST', body: new URLSearchParams(data) } : {}), signal: AbortSignal.timeout(30000) });
    for (const cookie of response.headers.getSetCookie()) { const first = cookie.split(';')[0]; cookies.set(first.slice(0, first.indexOf('=')), first.slice(first.indexOf('=') + 1)); }
    return response;
  };
}
async function login(name) {
  const request = client(); await (await request('/wp-login.php')).arrayBuffer();
  const result = await request('/wp-login.php', { log: name, pwd: 'fullbleed-local-test', testcookie: '1', 'wp-submit': 'Log In', redirect_to: base + '/wp-admin/' });
  const html = await result.text();
  assert.ok(result.headers.getSetCookie().some(cookie => cookie.startsWith('wordpress_logged_in_')), `Login ${name}: ${document(html).querySelector('#login_error')?.textContent || result.status}`);
  return request;
}
function document(html) { return new JSDOM(html).window.document; }
const body = async response => ({ status: response.status, headers: response.headers, text: await response.text() });
const rateReset = () => php(`WC_Rate_Limiter::set_rate_limit('fullbleed_customer_summary_' . get_user_by('login', 'fb-buyer-one')->ID, -10);`);
const requests = () => phpJson(`(int) get_option('fullbleed_fixture_requests', 0)`);
const config = { url: 'https://renderer.example.test', site: 'synthetic-store', token: 'synthetic-renderer-token-not-for-production', consent: true, summary_emails: [], packing_emails: [], customer_downloads: true };
const setConfig = (value = config) => php(`update_option('fullbleed_automation', ${phpValue(value)}, false);`);
let ready = false;
try {
  if (packages) {
    for (const item of packageRecords) {
      const zip = await readFile(`dist/${item.filename}`); assert.equal(hash(zip), item.sha256);
      for (const [path, expected] of Object.entries(unzipSync(zip))) assert.equal(hash(await site.playground.readFileAsBuffer(`/wordpress/wp-content/plugins/${path}`)), hash(expected), path);
    }
    check('every installed plugin entry matches the final ZIP', true);
  }
  await php("wp_mkdir_p(ABSPATH . 'wp-content/mu-plugins');");
  await site.playground.writeFile('/wordpress/wp-content/mu-plugins/fullbleed-customer-fixture.php', new Uint8Array(await readFile('tools/customer-downloads-fixture.php')));
  const fixture = JSON.parse(await php(`
    $one = wp_create_user('fb-buyer-one', 'fullbleed-local-test', 'buyer-one@example.test'); (new WP_User($one))->set_role('customer');
    $two = wp_create_user('fb-buyer-two', 'fullbleed-local-test', 'buyer-two@example.test'); (new WP_User($two))->set_role('customer');
    foreach (array(12 => $one, 13 => $two, 14 => $one) as $id => $owner) { $order = wc_get_order($id); $order->set_customer_id($owner); $order->save(); }
    $guest = wc_create_order(); $guest->set_status('processing'); $guest->save();
    $partial = wc_create_order(array('customer_id' => $one)); $partial->set_total('10.00'); $partial->set_status('processing'); $partial->save();
    $refund = wc_create_refund(array('order_id' => $partial->get_id(), 'amount' => '1.00', 'refund_payment' => false, 'restock_items' => false));
    if (is_wp_error($refund)) throw new Exception('Fixture refund failed');
    if (wc_get_page_id('myaccount') < 1) update_option('woocommerce_myaccount_page_id', wp_insert_post(array('post_title' => 'My account', 'post_status' => 'publish', 'post_type' => 'page', 'post_content' => '[woocommerce_my_account]')));
    echo wp_json_encode(array('wordpress' => get_bloginfo('version'), 'woocommerce' => WC_VERSION, 'php' => PHP_VERSION, 'hpos' => \\Automattic\\WooCommerce\\Utilities\\OrderUtil::custom_orders_table_usage_is_enabled(), 'ordersUrl' => wc_get_account_endpoint_url('orders'), 'viewUrl' => wc_get_order(12)->get_view_order_url(), 'guest' => $guest->get_id(), 'partial' => $partial->get_id()));
  `));
  assert.equal(fixture.hpos, hpos);
  const order = await phpJson(`(function () { $r = new WP_REST_Request(); $r['id'] = 12; return \\Fullbleed\\Commerce\\get_order($r)->get_data(); })()`);
  const template = starterTemplate({ kind: 'order-summary' });
  template.html = template.html.replace('{{document.title}}', 'YOUR CEDAR ORDER');
  await php(`update_option('fullbleed_template_order-summary', array('template' => ${phpValue(template)}, 'revision' => 'synthetic-customer-v1'), false);`);
  const render = createRenderer({ clients: [{ site: config.site, tokenSha256: hash(config.token) }] });
  const result = await render(new Request('https://renderer.example.test/v1/render', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`, 'X-Fullbleed-Site': config.site }, body: JSON.stringify({ order, options: { kind: 'order-summary', design: 'studio', template } }) }));
  assert.equal(result.status, 200); const pdf = Buffer.from(await result.arrayBuffer());
  await site.playground.writeFile('/tmp/fullbleed-customer.pdf', new Uint8Array(pdf));
  const owner = await login('fb-buyer-one'); const other = await login('fb-buyer-two'); const admin = await login('admin');
  const linkFrom = html => document(html).querySelector('a.fullbleed-summary')?.href;
  const ordersHtml = () => owner(fixture.ordersUrl).then(r => r.text());
  check('customer downloads start disabled', !linkFrom(await ordersHtml()));
  await setConfig();
  const html = await ordersHtml(); const link = linkFrom(html);
  check('My Account lists one PDF action for the eligible owned order', !!link && document(html).querySelectorAll('a.fullbleed-summary').length === 1);
  check('order details also expose one native PDF action', document(await (await owner(fixture.viewUrl)).text()).querySelectorAll('a.fullbleed-summary').length === 1);
  check('account page does not expose renderer credentials or endpoints', !html.includes(config.token) && !html.includes(config.url));
  const denialStart = await requests();
  const altered = (key, value) => { const url = new URL(link); url.searchParams.set(key, value); return url.href; };
  check('anonymous replay of an owner link is forbidden', (await body(await client()(link))).status === 403);
  check('another customer cannot reuse the owner nonce', (await body(await other(link))).status === 403);
  // Generate session-valid nonces for each ID using WordPress's own cookie auth
  // in a fixture-only page. This deliberately proves that nonces confer no access.
  await site.playground.writeFile('/wordpress/fullbleed-test-nonce.php', new TextEncoder().encode("<?php require __DIR__ . '/wp-load.php'; if ('127.0.0.1' !== wp_parse_url(home_url(), PHP_URL_HOST) || !is_user_logged_in()) exit; echo wp_create_nonce('fullbleed_customer_summary_' . absint($_GET['id'] ?? 0));"));
  async function validLink(request, id) { const url = new URL(link); url.searchParams.set('order_id', String(id)); url.searchParams.set('_wpnonce', await (await request(`/fullbleed-test-nonce.php?id=${id}`)).text()); return url.href; }
  for (const [name, id] of [['another customer', 13], ['guest', fixture.guest], ['refunded', 14], ['partially refunded', fixture.partial], ['missing', 999999]]) {
    check(`${name} order denied even with a valid customer nonce`, (await body(await owner(await validLink(owner, id)))).status === 404);
  }
  check('staff capabilities do not bypass customer ownership', (await body(await admin(await validLink(admin, 12)))).status === 404);
  check('missing or malformed nonce is rejected', (await body(await owner(altered('_wpnonce', '')))).status === 403);
  check('negative, overflowing and array order IDs fail closed', (await Promise.all(['-12', '999999999999999999999999999999', '12abc'].map(async id => (await body(await owner(altered('order_id', id)))).status))).every(status => status === 403) && (await body(await owner(link.replace('order_id=12', 'order_id%5B%5D=12')))).status === 403);
  check('unsupported request method is rejected', (await body(await owner(link, { ignored: '1' }))).status === 405);
  // WooCommerce creates a refund when an order enters refunded status. That
  // irreversible fixture transition is covered by the separate refunded order.
  for (const status of ['pending', 'on-hold', 'failed', 'cancelled']) {
    await php(`$o = wc_get_order(12); $o->set_status('${status}'); $o->save();`);
    assert.equal((await body(await owner(link))).status, 404); assert.equal(linkFrom(await ordersHtml()), undefined);
  }
  check('ineligible status changes hide the action and revoke old links', true);
  await php("$o=wc_get_order(12); $o->set_status('completed'); $o->save();");
  check('completed orders remain eligible', !!linkFrom(await ordersHtml()));
  await php("$o=wc_get_order(12); $o->set_status('processing'); $o->save();");
  check('all denied requests avoid the renderer', await requests() === denialStart);
  const downloaded = await owner(link); const bytes = Buffer.from(await downloaded.arrayBuffer());
  check('owner HTTP download equals actual Fullbleed PDF bytes', downloaded.status === 200 && hash(bytes) === hash(pdf));
  check('PDF response is private and cannot be cached or sniffed', /no-store/.test(downloaded.headers.get('cache-control')) && /private/.test(downloaded.headers.get('cache-control')) && downloaded.headers.get('referrer-policy') === 'no-referrer' && downloaded.headers.get('x-content-type-options') === 'nosniff');
  check('PDF has a useful filename, correct type and complete length', downloaded.headers.get('content-type') === 'application/pdf' && downloaded.headers.get('content-disposition') === 'attachment; filename="order-summary-12.pdf"' && Number(downloaded.headers.get('content-length')) === pdf.length);
  const forwarded = JSON.parse(await site.playground.readFileAsText('/tmp/fullbleed-customer-request.json'));
  check('customer PDF uses the exact saved merchant template and Woo order data', JSON.stringify(forwarded) === JSON.stringify({ order, options: { kind: 'order-summary', design: 'studio', template } }));
  const count = await requests(); const limited = await body(await owner(link));
  check('repeat clicks receive a retry delay without another render', limited.status === 429 && limited.headers.get('retry-after') === '30' && await requests() === count);
  for (const mode of ['offline', 'remote-error', 'corrupt']) {
    await rateReset(); await php(`update_option('fullbleed_fixture_mode', '${mode}');`);
    const failure = await body(await owner(link));
    check(`${mode} renderer produces a private recoverable error with no remote details`, failure.status === 503 && /no-store/.test(failure.headers.get('cache-control')) && failure.text.includes('Return to your account') && !failure.text.includes('PRIVATE-REMOTE-DETAILS') && !failure.text.includes('%PDF-') && !failure.text.includes(config.token));
  }
  check('renderer failure records a safe merchant recovery status', (await phpJson("wc_get_order(12)->get_meta('_fullbleed_customer_download_result')")).code === 'invalid_pdf');
  const failureActivity = await phpJson("\\Fullbleed\\CommercePro\\Activity\\rows(true)");
  check('actual customer-download failures appear in merchant activity', failureActivity.length === 1 && failureActivity[0].channel === 'customer' && failureActivity[0].state === 'failed' && failureActivity[0].code === 'invalid_pdf');
  check('customer cannot open the merchant activity HTTP page', (await body(await owner('/wp-admin/admin.php?page=fullbleed-activity'))).status === 403);
  for (const mode of ['reassign', 'cancel', 'disconnect']) {
    await rateReset(); await php(`update_option('fullbleed_fixture_mode', '${mode}');`);
    const denied = await body(await owner(link));
    check(`${mode} during rendering prevents PDF bytes from leaving WordPress`, denied.status === 404 && !denied.text.includes('%PDF-'));
    await php("$o = wc_get_order(12); $o->set_customer_id(get_user_by('login', 'fb-buyer-one')->ID); $o->set_status('processing'); $o->save();"); await setConfig();
  }
  const beforeDisabled = await requests();
  for (const disabled of [{ ...config, customer_downloads: false }, { ...config, consent: false }, { ...config, token: '' }]) { await setConfig(disabled); assert.equal((await body(await owner(link))).status, 404); assert.equal(linkFrom(await ordersHtml()), undefined); }
  check('disabled portal, withdrawn processing consent or missing credentials revoke old links', await requests() === beforeDisabled);
  await setConfig(); await rateReset(); await php("update_option('fullbleed_fixture_mode', 'ok');");
  const recovery = await owner(link);
  check('a later customer retry succeeds after renderer recovery', recovery.status === 200 && hash(Buffer.from(await recovery.arrayBuffer())) === hash(pdf));
  check('successful recovery clears the failed merchant status', (await phpJson("wc_get_order(12)->get_meta('_fullbleed_customer_download_result')")).state === 'prepared');
  const recoveredActivity = await phpJson("\\Fullbleed\\CommercePro\\Activity\\rows()");
  check('actual customer recovery replaces failure with response readiness', recoveredActivity.length === 1 && recoveredActivity[0].state === 'ready' && (await phpJson("\\Fullbleed\\CommercePro\\Activity\\rows(true)")).length === 0);
  const finalOrder = await phpJson(`(function () { $r = new WP_REST_Request(); $r['id'] = 12; return \\Fullbleed\\Commerce\\get_order($r)->get_data(); })()`);
  check('download leaves order totals, addresses and status intact', JSON.stringify(order) === JSON.stringify(finalOrder));
  // Remove the fixture-only nonce generator before browser checks or leaving a preview running.
  await site.playground.unlink('/wordpress/fullbleed-test-nonce.php');
  await rateReset();
  await mkdir('output/automation', { recursive: true }); await mkdir('target/wordpress', { recursive: true });
  await writeFile(`output/automation/${stem}.pdf`, pdf);
  await writeFile(`output/automation/${stem}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), ...fixture, packages: packageRecords, checks, pdfSha256: hash(pdf), transport: 'Real WordPress login, WooCommerce My Account pages and admin-post HTTP. Renderer HTTPS response substituted by a test-only WordPress filter using actual Fullbleed bytes for the exact order and saved template. No email, payment or production service.' }, null, 2));
  if (serve) await writeFile('target/wordpress/customer-browser.json', JSON.stringify({ ...fixture, base, pdfSha256: hash(pdf), packages: packageRecords }, null, 2));
  console.log(`${stem}: ${checks.length} checks passed.`);
  ready = true;
} catch (error) { console.error(error.stack || String(error)); process.exitCode = 1; }
if (serve && ready) {
  console.log(`FULLBLEED_CUSTOMER_PREVIEW_READY ${base}`);
  process.on('SIGINT', async () => { await site[Symbol.asyncDispose](); process.exit(0); });
} else await site[Symbol.asyncDispose]();
