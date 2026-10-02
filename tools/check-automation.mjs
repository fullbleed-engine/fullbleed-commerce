// SPDX-License-Identifier: MIT
// Disposable synthetic WooCommerce and captured mail only. No message leaves it.
import { runCLI } from '@wp-playground/cli';
import { resolve } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRenderer } from '../automation/renderer.js';

const hpos = process.argv.includes('--hpos');
const port = hpos ? 9478 : 9479;
const token = 'synthetic-renderer-token-not-for-production';
const site = await runCLI({
  command: 'server', php: '8.3', wp: 'latest', port, login: false, workers: 1, quiet: true,
  'define-bool': { WP_HTTP_BLOCK_EXTERNAL: true, DISABLE_WP_CRON: true },
  'site-url': `http://127.0.0.1:${port}`,
  mount: ['fullbleed-commerce', 'fullbleed-commerce-pro'].map(name => ({ hostPath: resolve('wordpress', name), vfsPath: `/wordpress/wp-content/plugins/${name}` })),
  blueprint: { steps: [
    { step: 'installPlugin', pluginData: { resource: 'wordpress.org/plugins', slug: 'woocommerce' }, options: { activate: true } },
    { step: 'runPHP', code: `<?php require '/wordpress/wp-load.php'; update_option('woocommerce_custom_orders_table_enabled', '${hpos ? 'yes' : 'no'}');` },
    ...['fullbleed-commerce', 'fullbleed-commerce-pro'].map(name => ({ step: 'activatePlugin', pluginPath: `${name}/${name}.php` })),
    { step: 'runPHP', code: await readFile('tools/seed-wordpress.php', 'utf8') },
  ] },
});
await new Promise((done, reject) => site.server.close(error => error ? reject(error) : done()));
await new Promise((done, reject) => { site.server.once('error', reject); site.server.listen(port, '127.0.0.1', done); });
try {
  const serialized = await site.playground.run({ code: `<?php require '/wordpress/wp-load.php'; $request = new WP_REST_Request(); $request['id'] = 12; echo wp_json_encode(\\Fullbleed\\Commerce\\get_order($request)->get_data());` });
  const order = JSON.parse(serialized.text);
  assert.equal(order.number, '12');
  const render = createRenderer({ clients: [{ site: 'synthetic-store', tokenSha256: createHash('sha256').update(token).digest('hex') }] });
  const response = await render(new Request('https://renderer.example.test/v1/render', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fullbleed-Site': 'synthetic-store', Authorization: `Bearer ${token}` }, body: JSON.stringify({ order, options: { kind: 'order-summary', design: 'studio' } }) }));
  assert.equal(response.status, 200);
  const pdf = Buffer.from(await response.arrayBuffer());
  await site.playground.writeFile('/tmp/fullbleed-test.pdf', new Uint8Array(pdf));
  const phpChecks = (await readFile('tools/check-automation.php', 'utf8')).replace('<?php', `<?php define('FULLBLEED_TEST_UNIX_PERMISSIONS', ${process.platform !== 'win32' ? 'true' : 'false'});`);
  const result = await site.playground.run({ code: phpChecks });
  assert.equal(result.exitCode, 0, result.errors);
  const record = JSON.parse(result.text);
  assert.ok(record.checks.length >= 10 && record.checks.every(item => item.passed));
  const cleanup = await site.playground.run({ code: `<?php $paths=json_decode(file_get_contents('/tmp/fullbleed-attachment-paths.json'),true); echo json_encode(array_map('file_exists',$paths));` });
  assert.ok(JSON.parse(cleanup.text).every(exists => !exists));
  record.checks.push({ name: 'private attachments are deleted after the mail request', passed: true });
  const deferred = await site.playground.run({ code: `<?php require '/wordpress/wp-load.php'; echo json_encode(has_action('woocommerce_order_status_pending_to_processing', array('WC_Emails', 'queue_transactional_email')) !== false);` });
  assert.equal(JSON.parse(deferred.text), true);
  record.checks.push({ name: 'next request wires order transitions to the WooCommerce email queue', passed: true });
  const mime = Buffer.from(await site.playground.readFileAsBuffer('/tmp/fullbleed-captured.eml'));
  assert.ok(mime.toString().replaceAll('\r\n', '\n').includes(pdf.toString('base64').match(/.{1,76}/g).join('\n')));
  record.checks.push({ name: 'captured WooCommerce email contains exact complete renderer PDF bytes', passed: true });
  await mkdir('output/automation', { recursive: true });
  const stem = hpos ? 'woocommerce-hpos' : 'woocommerce-legacy';
  await writeFile(`output/automation/${stem}.pdf`, pdf);
  await writeFile(`output/automation/${stem}.eml`, mime);
  await writeFile(`output/automation/${stem}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), ...record, hpos, unixPermissionsChecked: process.platform !== 'win32', pdfSha256: createHash('sha256').update(pdf).digest('hex'), transport: 'Real WooCommerce hooks and PHPMailer MIME with outbound mail captured. HTTPS response supplied through the WordPress HTTP test filter using actual Fullbleed output from this exact order. No production network or delivery claim.' }, null, 2));
  console.log(`${stem}: ${record.checks.length} automation checks passed; no email sent.`);
} catch (error) {
  console.error(error.message || String(error)); process.exitCode = 1;
} finally { await site[Symbol.asyncDispose](); }
