// SPDX-License-Identifier: MIT
// Summarize completed local checks without copying credentials or order payloads.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function tap(path) {
  const bytes = readFileSync(path);
  const text = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8');
  const passed = Number(text.match(/^# pass (\d+)/m)?.[1]);
  const failed = Number(text.match(/^# fail (\d+)/m)?.[1]);
  assert.ok(passed > 0 && failed === 0, `Tests must pass: ${path}`);
  return { passed, failed, logSha256: hash(path) };
}
function wordpress(stem) {
  const record = json(`output/wordpress/${stem}-verification.json`);
  assert.ok(record.checks.every(check => check.passed));
  return { runtime: json(`output/wordpress/${stem}-runtime.json`), checks: record.checks, configuration: record.configuration };
}
const packages = json('dist/packages.json');
assert.deepEqual(packages, json('output/wordpress/packaged-hpos-pro-packages.json'), 'The checked ZIPs must match the final packages.');
for (const item of packages) assert.equal(hash(`dist/${item.filename}`), item.sha256);
const app = json('output/shopify/verification.json');
assert.ok(app.checks.every(check => check.passed));
const installed = json('output/shopify/installed-store/verification.json');
assert.equal(installed.passed, true, 'Keep failed live checks separate from a completed verification record.');
assert.ok(installed.documents.length === 6 && installed.documents.every(item => item.missingGlyphs === 0));
for (const item of installed.documents) assert.equal(hash(`output/shopify/installed-store/${item.stem}.pdf`), item.sha256);
const examples = json('output/examples/verification.json');
for (const item of examples) assert.equal(hash(`output/examples/${item.stem}.pdf`), item.sha256);
const record = {
  checkedAt: new Date().toISOString(), previewVersion: json('package.json').version,
  sourceLocks: { root: hash('package-lock.json'), shopify: hash('shopify/app/package-lock.json') },
  packages, sharedTests: tap('output/node-tests.log'),
  wordpress: { legacyFree: wordpress('legacy-free'), packagedHposPro: wordpress('packaged-hpos-pro') },
  examples, textChecks: json('output/pdf-text-verification.json'),
  shopify: { app, requestHandlerTests: tap('output/shopify/webhooks.log'), installedStore: installed, graphQLValidation: json('output/shopify/validation/verification.json') },
  dependencyAudit: { root: json('output/npm-audit.json').metadata.vulnerabilities, shopify: json('output/shopify/npm-audit.json').metadata.vulnerabilities },
  visualInspection: { exampleOrderDesigns: ['studio', 'contrast', 'quiet'], longPackingSlipPage: 8, liveShopify: ['studio-order-summary', 'contrast-order-summary', 'quiet-packing-slip'] },
  limits: { realBrowserTested: false, liveBillingTested: false, productionDeployed: false, marketplaceApproved: false, isoConformanceClaimed: false },
  budget: json('docs/launch-budget.json'),
};
writeFileSync('docs/verification.json', JSON.stringify(record, null, 2) + '\n');
console.log('Retained sanitized verification summary in docs/verification.json');
