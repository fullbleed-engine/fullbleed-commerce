// SPDX-License-Identifier: MIT
// Summarize completed local checks without copying credentials or order payloads.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const json = path => { const bytes = readFileSync(path); return JSON.parse(bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '')); };
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function tap(path) {
  const bytes = readFileSync(path);
  const text = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8');
  const passed = Number(text.match(/^(?:#|ℹ) pass (\d+)/m)?.[1]);
  const failed = Number(text.match(/^(?:#|ℹ) fail (\d+)/m)?.[1]);
  assert.ok(passed > 0 && failed === 0, `Tests must pass: ${path}`);
  return { passed, failed, logSha256: hash(path) };
}
function wordpress(stem) {
  const record = json(`output/wordpress/${stem}-verification.json`);
  assert.ok(record.checks.every(check => check.passed));
  return { runtime: json(`output/wordpress/${stem}-runtime.json`), checks: record.checks, configuration: record.configuration };
}
const packages = json('dist/packages.json');
const finalAssets = json('output/wordpress/final-asset-verification.json');
assert.ok(finalAssets.length === 2 && finalAssets.every(site => site.checks.every(check => check.passed)));
const customerPortal = { hpos: json('output/automation/customer-hpos.json'), legacy: json('output/automation/customer-legacy.json'), browser: json('output/browser/wordpress-customer-verification.json') };
assert.ok(Object.values(customerPortal).every(result => result.checks.length > 10 && result.checks.every(check => check.passed)));
for (const storage of ['hpos', 'legacy']) assert.equal(hash(`output/automation/customer-${storage}.pdf`), customerPortal[storage].pdfSha256);
assert.equal(hash('output/browser/wordpress-customer-summary.pdf'), customerPortal.browser.pdfSha256);
assert.equal(hash('output/browser/wordpress-customer-staff-preview.pdf'), customerPortal.browser.pdfSha256);
for (const item of customerPortal.browser.evidence) assert.equal(hash(item.file), item.sha256);
const archiveChecks = [];
for (const item of packages) {
  for (const record of Object.values(customerPortal)) assert.equal(record.packages.find(candidate => candidate.filename === item.filename)?.sha256, item.sha256, 'Portal and browser checks must use the final archives.');
  archiveChecks.push({ filename: item.filename, exactInstalledArchive: true, everyInstalledEntryVerified: true, installations: ['customer-hpos', 'customer-legacy'], browserChecked: true });
}
for (const item of packages) assert.equal(hash(`dist/${item.filename}`), item.sha256);
const app = json('output/shopify/verification.json');
assert.ok(app.checks.every(check => check.passed));
const privacyBrowser = json('output/browser/shopify-privacy-verification.json');
assert.ok(privacyBrowser.checks.length >= 13 && privacyBrowser.checks.every(check => check.passed));
assert.equal(privacyBrowser.productionBuildSha256, app.serverBuildSha256, 'Privacy browser must exercise the verified production build.');
for (const item of privacyBrowser.evidence) assert.equal(hash(item.file), item.sha256);
const privacyUiValidation = json('output/shopify/privacy-ui-minimal-validation.json');
const installed = json('output/shopify/installed-store/verification.json');
assert.equal(installed.passed, true, 'Keep failed live checks separate from a completed verification record.');
assert.ok(installed.documents.length === 6 && installed.documents.every(item => item.missingGlyphs === 0));
for (const item of installed.documents) assert.equal(hash(`output/shopify/installed-store/${item.stem}.pdf`), item.sha256);
const examples = json('output/examples/verification.json');
for (const item of examples) assert.equal(hash(`output/examples/${item.stem}.pdf`), item.sha256);
const browser = { wordpressFree: json('output/browser/wordpress-free-verification.json'), wordpressPro: json('output/browser/wordpress-pro-verification.json'), shopify: json('output/browser/shopify-verification.json') };
assert.ok(Object.values(browser).every(result => result.checks.every(check => check.passed)));
const flowBrowser = json('output/browser/shopify-flow-verification.json');
assert.ok(flowBrowser.checks.every(check => check.passed));
for (const item of flowBrowser.documents) assert.equal(hash(`output/browser/shopify-flow-${item.kind}.pdf`), item.sha256);
for (const item of flowBrowser.evidence) assert.equal(hash(item.file), item.sha256);
const orderTrigger = json('docs/order-trigger-verification.json');
assert.ok(orderTrigger.syntheticOnly && orderTrigger.checks.length > 40 && orderTrigger.checks.every(check => check.passed));
assert.equal(orderTrigger.documents.length, 2);
for (const item of orderTrigger.documents) assert.equal(hash(`output/browser/shopify-order-trigger-${item.kind}.pdf`), item.pdfSha256);
for (const item of orderTrigger.evidence) assert.equal(hash(item.file), item.sha256);
assert.ok(json('output/shopify/flow-config-validation.json').valid);
const templates = json('output/templates/verification.json');
for (const item of templates.documents) assert.equal(hash(`output/templates/${item.kind}.pdf`), item.sha256);
const automation = { hpos: json('output/automation/woocommerce-hpos.json'), legacy: json('output/automation/woocommerce-legacy.json'), settingsHttp: json('output/automation/settings-http.json') };
assert.ok(Object.values(automation).every(result => result.checks.every(check => check.passed)));
for (const [name, result] of [['woocommerce-hpos', automation.hpos], ['woocommerce-legacy', automation.legacy]]) assert.equal(hash(`output/automation/${name}.pdf`), result.pdfSha256);
const record = {
  checkedAt: new Date().toISOString(), previewVersion: json('package.json').version,
  sourceLocks: { root: hash('package-lock.json'), shopify: hash('shopify/app/package-lock.json') },
  packages, archiveChecks, sharedTests: tap('output/node-tests.log'),
  wordpress: { legacyFree: wordpress('legacy-free'), packagedHposPro: wordpress('packaged-hpos-pro'), finalAssets },
  browser, templates, automation, customerPortal, orderTrigger,
  examples, textChecks: json('output/pdf-text-verification.json'),
  shopify: { app, requestHandlerTests: tap('output/shopify/webhooks.log'), flowTests: tap('output/shopify/flow.log'), privacyTests: tap('output/shopify/privacy.log'), privacyBrowser, privacyUiToolkit: { success: privacyUiValidation.success, version: privacyUiValidation.resolvedVersion, evidenceSha256: hash('output/shopify/privacy-ui-minimal-validation.json'), limitation: 'Remote validator cannot resolve its own preact/jsx-runtime and JSX types, including a minimal component. Installed types, production build and browser checks provide separate evidence.' }, flowBrowser, flowConfiguration: json('output/shopify/flow-config-validation.json'), installedStore: installed, graphQLValidation: json('output/shopify/validation/verification.json') },
  monitoring: { requestHandlerTests: tap('output/shopify/monitor.log'), notificationDeliveryVerified: false, scheduledEnabled: false },
  recovery: { tests: tap('output/shopify/recovery.log'), hosted: json('docs/recovery-verification.json'), automaticBackups: json('docs/backup-schedule-verification.json'), backupScheduleEnabled: true, executesOnlyWhileOnline: true, independentKeyRecoveryVerified: false },
  dependencyAudit: { root: json('output/npm-audit.json').metadata.vulnerabilities, shopify: json('output/shopify/npm-audit.json').metadata.vulnerabilities, shopifyProduction: json('output/shopify/npm-audit-production.json').metadata.vulnerabilities },
  visualInspection: { exampleOrderDesigns: ['studio', 'contrast', 'quiet'], longPackingSlipPage: 8, customTemplates: ['order-summary', 'packing-slip'], wordpressEditor: ['desktop', '390px viewport'], customerPortal: ['saved-template-pdf', 'orders', 'order-details', '390px viewport'], liveShopify: ['studio-order-summary', 'contrast-order-summary', 'quiet-packing-slip'] },
  limits: { realBrowserTested: true, wordpressBrowserTested: true, shopifyBrowserTested: true, liveBillingTested: false, productionDeployed: false, marketplaceApproved: false, isoConformanceClaimed: false },
  budget: json('docs/launch-budget.json'),
};
writeFileSync('docs/verification.json', JSON.stringify(record, null, 2) + '\n');
console.log('Retained sanitized verification summary in docs/verification.json');
