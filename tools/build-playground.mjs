// SPDX-License-Identifier: MIT
// Keep the public Blueprint reproducible without embedding plugin binaries.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { validateBlueprint } from '@wp-playground/blueprints';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const blueprint = {
  $schema: 'https://playground.wordpress.net/blueprint-schema.json',
  meta: { title: 'Fullbleed Commerce: design your order documents', author: 'fullbleed-engine', description: 'Try the free visual and HTML/CSS editor with fictional WooCommerce orders. No account, connected store or payment required.' },
  landingPage: '/wp-admin/admin.php?page=fullbleed-commerce',
  preferredVersions: { php: '8.3', wp: '7.1' },
  features: { networking: false },
  constants: { FULLBLEED_COMMERCE_DEMO: true, WP_HTTP_BLOCK_EXTERNAL: true, DISABLE_WP_CRON: true, WC_TRACKING_ENABLED: false },
  steps: [
    { step: 'mkdir', path: '/wordpress/wp-content/mu-plugins' },
    { step: 'writeFile', path: '/wordpress/wp-content/mu-plugins/fullbleed-demo.php', data: await readFile('playground/demo-plugin.php', 'utf8') },
    { step: 'installPlugin', pluginData: { resource: 'url', url: 'https://downloads.wordpress.org/plugin/woocommerce.11.1.2.zip' }, options: { activate: true } },
    { step: 'installPlugin', pluginData: { resource: 'url', url: `https://github.com/fullbleed-engine/fullbleed-commerce/releases/download/v${version}/fullbleed-commerce-${version}.zip` }, options: { activate: true } },
    { step: 'runPHP', code: await readFile('playground/seed.php', 'utf8') },
    { step: 'login' },
  ],
};
const validation = validateBlueprint(blueprint);
assert.equal(validation.valid, true, JSON.stringify(validation.errors));
const source = JSON.stringify(blueprint, null, 2) + '\n';
if (process.argv.includes('--check')) {
  assert.equal(await readFile('playground/blueprint.json', 'utf8'), source, 'Rebuild the Playground Blueprint.');
  console.log('Public Playground Blueprint is valid and matches its source.');
} else {
  await writeFile('playground/blueprint.json', source);
  console.log('Built playground/blueprint.json');
}
