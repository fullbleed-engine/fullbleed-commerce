// SPDX-License-Identifier: MIT
// WordPress plugins have their own versions; the integration package may be a prerelease.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function pluginMetadata(name) {
  assert.ok(['fullbleed-commerce', 'fullbleed-commerce-pro'].includes(name));
  const php = await readFile(`wordpress/${name}/${name}.php`, 'utf8');
  const readme = await readFile(`wordpress/${name}/readme.txt`, 'utf8');
  const version = php.match(/^\s*\* Version:\s*(\S+)\s*$/m)?.[1];
  assert.match(version ?? '', /^[0-9]+(?:\.[0-9]+)+(?:-[a-z0-9.]+)?$/, `${name}: invalid plugin version`);
  assert.equal(readme.match(/^Stable tag:\s*(\S+)\s*$/m)?.[1], version, `${name}: readme and PHP versions must match`);
  if (name === 'fullbleed-commerce') {
    assert.match(version, /^[0-9]+(?:\.[0-9]+)+$/, 'WordPress.org requires a numeric plugin version');
    assert.equal(php.match(/^const VERSION = '([^']+)';$/m)?.[1], version, 'Free plugin asset version must match its header');
  }
  return { plugin: name, version, filename: `${name}-${version}.zip` };
}
