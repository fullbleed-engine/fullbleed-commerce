// SPDX-License-Identifier: MIT
// Local synthetic store only. No production credentials or customer data.
import { runCLI } from '@wp-playground/cli';
import { resolve } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pluginMetadata } from './plugin-metadata.mjs';

const seed = await readFile('tools/seed-wordpress.php', 'utf8');
const usePro = process.argv.includes('--pro');
const useHpos = process.argv.includes('--hpos');
const usePackages = process.argv.includes('--packages');
const packageSteps = [];
if (usePackages) {
  for (const name of ['fullbleed-commerce', ...(usePro ? ['fullbleed-commerce-pro'] : [])]) {
    const { filename } = await pluginMetadata(name);
    packageSteps.push({ step: 'installPlugin', pluginData: { resource: 'literal', name: `${name}.zip`, contents: new Uint8Array(await readFile(`dist/${filename}`)) }, options: { activate: true } });
  }
}
const port = Number(process.env.FULLBLEED_TEST_PORT || 9475);
const site = await runCLI({
  command: 'server', php: '8.3', wp: 'latest', port, login: false, workers: 1, quiet: true,
  'define-bool': { WP_HTTP_BLOCK_EXTERNAL: true, DISABLE_WP_CRON: true },
  'site-url': `http://127.0.0.1:${port}`,
  mount: usePackages ? [] : ['fullbleed-commerce', 'fullbleed-commerce-pro'].map(name => ({ hostPath: resolve('wordpress', name), vfsPath: `/wordpress/wp-content/plugins/${name}` })),
  blueprint: {
    steps: [
      { step: 'installPlugin', pluginData: { resource: 'wordpress.org/plugins', slug: 'woocommerce' }, options: { activate: true } },
      { step: 'runPHP', code: `<?php require '/wordpress/wp-load.php'; update_option('woocommerce_custom_orders_table_enabled', '${useHpos ? 'yes' : 'no'}');` },
      ...(usePackages ? packageSteps : [
        { step: 'activatePlugin', pluginPath: 'fullbleed-commerce/fullbleed-commerce.php' },
        ...(usePro ? [{ step: 'activatePlugin', pluginPath: 'fullbleed-commerce-pro/fullbleed-commerce-pro.php' }] : []),
      ]),
      { step: 'runPHP', code: seed },
    ],
  },
});
// Restrict the dev server to loopback regardless of the CLI's default binding.
await new Promise((resolve, reject) => site.server.close(error => error ? reject(error) : resolve()));
await new Promise((resolve, reject) => { site.server.once('error', reject); site.server.listen(port, '127.0.0.1', resolve); });
await mkdir('target/wordpress', { recursive: true });
const state = await site.playground.run({ code: `<?php require '/wordpress/wp-load.php'; echo json_encode(array('wordpress' => get_bloginfo('version'), 'woocommerce' => WC_VERSION, 'php' => PHP_VERSION, 'hpos' => \\Automattic\\WooCommerce\\Utilities\\OrderUtil::custom_orders_table_usage_is_enabled()));` });
await writeFile('target/wordpress/runtime.json', state.text);
await writeFile('target/wordpress/server.json', JSON.stringify({ url: site.serverUrl, pro: usePro, hpos: useHpos, packages: usePackages, port }, null, 2));
console.log(`FULLBLEED_LOCAL_STORE_READY http://127.0.0.1:${port} pro=${usePro} hpos=${useHpos}`);
process.on('SIGINT', async () => { await site[Symbol.asyncDispose](); process.exit(0); });
