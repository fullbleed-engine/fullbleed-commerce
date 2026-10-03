// SPDX-License-Identifier: MIT
// Upgrade released ZIPs in disposable WordPress. Fictional data; outbound mail blocked.
import { runCLI } from '@wp-playground/cli';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { starterTemplate } from '../src/documents.js';
import { renderOrder } from '../src/node.js';
import { pluginMetadata } from './plugin-metadata.mjs';

const oldVersion = '0.1.1';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
assert.notEqual(version, oldVersion, 'The candidate must have a new version.');
const hpos = process.argv.includes('--hpos');
const serve = process.argv.includes('--serve');
const port = hpos ? 9494 : 9495;
const stem = `upgrade-${hpos ? 'hpos' : 'legacy'}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const checks = [];
const check = (name, result) => { assert.ok(result, name); checks.push({ name, passed: true }); console.log(`${name}: passed`); };
const previous = [
  { name: 'fullbleed-commerce', sha256: '03f5ee1b8670a625457faa65d088c863e3e84f9f8b2f3208c5d1950d0f554f41' },
  { name: 'fullbleed-commerce-pro', sha256: 'fdebf14cc795bafb606edf11743a1ee17e7eeb05c9e224938adba780ed1dce22' },
];
const candidates = await Promise.all(previous.map(entry => pluginMetadata(entry.name)));
const pluginVersions = candidates.map(entry => entry.version);
await mkdir('target/upgrade-input', { recursive: true });
await mkdir('output/upgrade', { recursive: true });
for (const entry of previous) {
  const filename = `${entry.name}-${oldVersion}.zip`;
  const path = `target/upgrade-input/${filename}`;
  let bytes;
  try { bytes = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes) {
    const response = await fetch(`https://github.com/fullbleed-engine/fullbleed-commerce/releases/download/v${oldVersion}/${filename}`, { signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, `Download ${filename}`);
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(hash(bytes), entry.sha256, filename);
    await writeFile(path, bytes);
  }
  assert.equal(hash(bytes), entry.sha256, filename);
  entry.bytes = bytes;
}
const packages = JSON.parse(await readFile('dist/packages.json', 'utf8'));
const site = await runCLI({
  command: 'server', php: '8.3', wp: 'latest', port, login: false, workers: 1, quiet: true,
  'define-bool': { WP_HTTP_BLOCK_EXTERNAL: true, DISABLE_WP_CRON: true }, 'site-url': `http://127.0.0.1:${port}`,
  blueprint: { steps: [
    { step: 'mkdir', path: '/wordpress/wp-content/mu-plugins' },
    { step: 'writeFile', path: '/wordpress/wp-content/mu-plugins/fullbleed-upgrade-fixture.php', data: "<?php add_filter('pre_wp_mail', function () { update_option('fullbleed_upgrade_mail_attempts', 1 + (int) get_option('fullbleed_upgrade_mail_attempts', 0)); return true; });" },
    { step: 'installPlugin', pluginData: { resource: 'wordpress.org/plugins', slug: 'woocommerce' }, options: { activate: true } },
    { step: 'runPHP', code: `<?php require '/wordpress/wp-load.php'; update_option('woocommerce_custom_orders_table_enabled', '${hpos ? 'yes' : 'no'}');` },
    ...previous.map(entry => ({ step: 'installPlugin', pluginData: { resource: 'literal', name: `${entry.name}.zip`, contents: new Uint8Array(entry.bytes) }, options: { activate: true } })),
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
const value = input => `json_decode(base64_decode('${Buffer.from(JSON.stringify(input)).toString('base64')}'), true)`;
const state = () => php(`
  require_once ABSPATH . 'wp-admin/includes/plugin.php';
  $fixture = json_decode(file_get_contents(ABSPATH . 'fullbleed-fixture.json'), true);
  $request = new WP_REST_Request(); $request['id'] = $fixture['orders'][0];
  echo wp_json_encode(array(
    'runtime' => $fixture,
    'hpos' => \\Automattic\\WooCommerce\\Utilities\\OrderUtil::custom_orders_table_usage_is_enabled(),
    'versions' => array_map(function ($name) { return get_plugin_data(WP_PLUGIN_DIR . '/' . $name . '/' . $name . '.php')['Version']; }, array('fullbleed-commerce', 'fullbleed-commerce-pro')),
    'active' => array_map('is_plugin_active', array('fullbleed-commerce/fullbleed-commerce.php', 'fullbleed-commerce-pro/fullbleed-commerce-pro.php')),
    'templates' => array(get_option('fullbleed_template_order-summary'), get_option('fullbleed_template_packing-slip')),
    'automation' => get_option('fullbleed_automation'),
    'order' => \\Fullbleed\\Commerce\\get_order($request)->get_data(),
    'mailAttempts' => (int) get_option('fullbleed_upgrade_mail_attempts', 0),
    'batchLimit' => apply_filters('fullbleed_commerce_batch_limit', 1),
    'activitySchema' => get_option('fullbleed_activity_schema', null),
    'activityCleanup' => (bool) wp_next_scheduled('fullbleed_activity_cleanup'),
    'failureAlerts' => get_option('fullbleed_failure_alerts', null),
    'failureAlertSchedule' => (bool) wp_next_scheduled('fullbleed_failure_alert_check')
  ));
`).then(JSON.parse);
let succeeded = false;
try {
  const summary = JSON.parse(await readFile('fixtures/pagination-saved-template.json', 'utf8')).template;
  summary.html = summary.html.replace('{{document.title}}', 'CEDAR UPGRADE ORDER');
  summary.css += '\nh1 { color: #9b3d22; }';
  const packing = starterTemplate({ kind: 'packing-slip' });
  packing.html = packing.html.replace('{{document.title}}', 'CAREFULLY PACKED');
  const config = { url: 'https://renderer.example.test', site: 'synthetic-upgrade-store', token: 'synthetic-upgrade-token-not-for-production', consent: true, summary_emails: ['customer_processing_order'], packing_emails: [], customer_downloads: true };
  await php(`update_option('fullbleed_template_order-summary', array('template' => ${value(summary)}, 'revision' => 'synthetic-summary-before-upgrade'), false);
    update_option('fullbleed_template_packing-slip', array('template' => ${value(packing)}, 'revision' => 'synthetic-packing-before-upgrade'), false);
    update_option('fullbleed_automation', ${value(config)}, false);`);
  const before = await state();
  check('candidate version upgrades the published 0.1.1 base', await php(`echo version_compare('${pluginVersions[0]}', '${oldVersion}', '>') ? 'yes' : 'no';`) === 'yes');
  check('released 0.1.1 base and Pro are active in the requested storage mode', before.versions.every(v => v === oldVersion) && before.active.every(Boolean) && before.hpos === hpos);
  check('released 0.1.1 has its activity schema and retention schedule', before.activitySchema === '1' && before.activityCleanup);
  check('released 0.1.1 starts with failure alerts disabled', before.failureAlerts === null && !before.failureAlertSchedule);
  const beforePdf = await renderOrder(before.order, { kind: 'order-summary', template: before.templates[0].template });
  await writeFile(`output/upgrade/${stem}-before.pdf`, beforePdf.pdf);
  for (const [index, entry] of previous.entries()) {
    const manifest = packages.find(p => p.filename === candidates[index].filename);
    assert.ok(manifest, 'Candidate archive is in packages.json');
    const bytes = await readFile(`dist/${manifest.filename}`);
    assert.equal(hash(bytes), manifest.sha256);
    await site.playground.writeFile(`/tmp/${entry.name}.zip`, new Uint8Array(bytes));
    await site.playground.writeFile(`/wordpress/wp-content/plugins/${entry.name}/obsolete-upgrade-fixture.txt`, new TextEncoder().encode('Must be removed by WordPress package replacement.'));
    // Use the WordPress ZIP replacement path, not a virtual filesystem overwrite.
    // https://developer.wordpress.org/reference/classes/plugin_upgrader/install/
    const result = JSON.parse(await php(`
      require_once ABSPATH . 'wp-admin/includes/file.php';
      require_once ABSPATH . 'wp-admin/includes/plugin.php';
      require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
      wp_set_current_user(1);
      $upgrader = new Plugin_Upgrader(new WP_Ajax_Upgrader_Skin());
      $result = $upgrader->install('/tmp/${entry.name}.zip', array('overwrite_package' => true));
      if (is_wp_error($result)) throw new Exception($result->get_error_message());
      echo wp_json_encode(array('ok' => $result === true, 'errors' => $upgrader->skin->get_errors()->get_error_messages()));
    `));
    check(`WordPress replaces ${entry.name} without upgrader errors`, result.ok && result.errors.length === 0);
    for (const [path, expected] of Object.entries(unzipSync(bytes))) assert.equal(hash(await site.playground.readFileAsBuffer(`/wordpress/wp-content/plugins/${path}`)), hash(expected), path);
    check(`every installed ${entry.name} file matches its candidate ZIP`, true);
    check(`WordPress removes obsolete ${entry.name} files`, await php(`echo file_exists(WP_PLUGIN_DIR . '/${entry.name}/obsolete-upgrade-fixture.txt') ? 'present' : 'absent';`) === 'absent');
    const current = await state();
    check(`${entry.name} replacement preserves both templates and revisions`, JSON.stringify(current.templates) === JSON.stringify(before.templates));
    check(`${entry.name} replacement preserves automation configuration`, JSON.stringify(current.automation) === JSON.stringify(before.automation));
    check(`${entry.name} replacement preserves orders and does not send mail`, JSON.stringify(current.order) === JSON.stringify(before.order) && current.mailAttempts === before.mailAttempts);
    check(`${entry.name} replacement keeps both plugins active`, current.active.every(Boolean));
    assert.deepEqual(current.versions, index === 0 ? [pluginVersions[0], oldVersion] : pluginVersions);
    check(index === 0 ? 'new base remains compatible with the previous Pro version during upgrade' : 'both installed plugin versions match the release candidate', current.batchLimit === 25);
  }
  const after = await state();
  check('upgrade preserves the activity schema and retention schedule', after.activitySchema === before.activitySchema && after.activityCleanup);
  check('upgrade leaves administrator failure alerts disabled until explicitly enabled', after.failureAlerts !== 'yes' && !after.failureAlertSchedule);
  const afterPdf = await renderOrder(after.order, { kind: 'order-summary', template: after.templates[0].template });
  await writeFile(`output/upgrade/${stem}-after.pdf`, afterPdf.pdf);
  check('saved document renders identical PDF bytes after both upgrades', hash(beforePdf.pdf) === hash(afterPdf.pdf));
  const record = { checkedAt: new Date().toISOString(), from: oldVersion, to: pluginVersions[0], integrationVersion: version, pluginVersions: Object.fromEntries(candidates.map(item => [item.plugin, item.version])), runtime: after.runtime, hpos, packages, checks, pdfSha256: hash(afterPdf.pdf), templateStateSha256: hash(JSON.stringify(after.templates)), automationPreserved: true, transport: 'WordPress Plugin_Upgrader ZIP replacement. Synthetic configuration only; mail blocked, renderer not contacted. PDF parity uses the real Node renderer; real browser verification is retained separately.' };
  await writeFile(`output/upgrade/${stem}.json`, JSON.stringify(record, null, 2) + '\n');
  succeeded = true;
  console.log(`${stem}: ${checks.length} checks passed.`);
} catch (error) {
  const message = error.message || String(error);
  await writeFile(`output/upgrade/${stem}-failure.json`, JSON.stringify({ checks, error: message }, null, 2) + '\n');
  console.error(message.slice(0, 1800));
  process.exitCode = 1;
} finally {
  if (serve && succeeded) {
    console.log(`FULLBLEED_UPGRADE_STORE_READY http://127.0.0.1:${port}`);
    process.on('SIGINT', async () => { await site[Symbol.asyncDispose](); process.exit(0); });
  } else await site[Symbol.asyncDispose]();
}
