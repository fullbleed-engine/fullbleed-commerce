// SPDX-License-Identifier: MIT
// Exercise the public demo Blueprint in a disposable, loopback-only WordPress.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runCLI } from '@wp-playground/cli';

const blueprintBytes = await readFile('playground/blueprint.json');
const blueprint = JSON.parse(blueprintBytes);
const packages = JSON.parse(await readFile('dist/packages.json', 'utf8'));
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const archive = packages.find(item => item.filename === `fullbleed-commerce-${version}.zip`);
assert.ok(archive);
const bytes = await readFile(`dist/${archive.filename}`);
assert.equal(createHash('sha256').update(bytes).digest('hex'), archive.sha256);
const install = blueprint.steps.find(step => step.pluginData?.url?.startsWith('https://github.com/fullbleed-engine/fullbleed-commerce/'));
assert.ok(install.pluginData.url.endsWith(`/${archive.filename}`));
// Only replace the public release download with its exact local bytes.
install.pluginData = { resource: 'literal', name: archive.filename, contents: new Uint8Array(bytes) };
const port = Number(process.env.FULLBLEED_DEMO_PORT || 9488);
const base = `http://127.0.0.1:${port}`;
const site = await runCLI({ command: 'server', php: blueprint.preferredVersions.php, wp: blueprint.preferredVersions.wp, port, login: false, workers: 1, quiet: true, 'site-url': base, blueprint });
try {
  await new Promise((resolve, reject) => site.server.close(error => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => { site.server.once('error', reject); site.server.listen(port, '127.0.0.1', resolve); });
  const result = await site.playground.run({ code: `<?php
require '/wordpress/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
$orders = array_map( function( $id ) {
    $order = wc_get_order( $id );
    return array( 'id' => $id, 'items' => count( $order->get_items() ), 'status' => $order->get_status(), 'paid' => $order->is_paid(), 'total' => $order->get_total() );
}, get_option( 'fullbleed_demo_orders', array() ) );
$mailer_used = false;
add_action( 'phpmailer_init', function() use ( &$mailer_used ) { $mailer_used = true; } );
$mail_result = wp_mail( 'nobody@example.test', 'Synthetic demo mail suppression check', 'Do not deliver.' );
$external = wp_remote_get( 'https://example.com', array( 'timeout' => 1 ) );
echo wp_json_encode( array(
    'wordpress' => get_bloginfo('version'), 'woocommerce' => WC_VERSION, 'php' => PHP_VERSION,
    'orders' => $orders, 'hpos' => \\Automattic\\WooCommerce\\Utilities\\OrderUtil::custom_orders_table_usage_is_enabled(),
    'mailSuppressed' => $mail_result && ! $mailer_used,
    'externalRequestBlocked' => is_wp_error( $external ),
    'cronDisabled' => DISABLE_WP_CRON, 'trackingDisabled' => false === WC_TRACKING_ENABLED,
    'freePluginActive' => is_plugin_active('fullbleed-commerce/fullbleed-commerce.php'),
    'proPluginActive' => is_plugin_active('fullbleed-commerce-pro/fullbleed-commerce-pro.php')
) );` });
  const runtime = JSON.parse(result.text);
  const checks = [];
  function check(name, value) { assert.ok(value, name); checks.push({ name, passed: true }); }
  check('exact released plugin archive installed', runtime.freePluginActive && !runtime.proPluginActive);
  check('two synthetic unpaid orders with short and long item lists', runtime.orders.length === 2 && runtime.orders.every(order => order.status === 'pending' && !order.paid) && runtime.orders[0].items === 2 && runtime.orders[1].items === 32);
  check('sample platform totals retained', runtime.orders[0].total === '282.00' && runtime.orders[1].total === '4332.00');
  check('HPOS order storage enabled', runtime.hpos);
  check('actual WordPress mail call short-circuited before transport', runtime.mailSuppressed);
  check('WordPress external request blocked', runtime.externalRequestBlocked);
  check('cron and WooCommerce tracking disabled', runtime.cronDisabled && runtime.trackingDisabled);
  await mkdir('output/playground', { recursive: true });
  const record = { checkedAt: new Date().toISOString(), source: 'Disposable local execution of public Blueprint with exact local release ZIP bytes', base, blueprintSha256: createHash('sha256').update(blueprintBytes).digest('hex'), archive, runtime, checks };
  await writeFile('output/playground/local-verification.json', JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
  if (process.argv.includes('--serve')) {
    console.log(`FULLBLEED_DEMO_READY ${base}`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally {
  await site[Symbol.asyncDispose]();
}
