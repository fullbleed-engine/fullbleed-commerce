// SPDX-License-Identifier: MIT
// Retain a release/demo delta without rewriting the historical whole-product record.
// Usage: node tools/retain-preview-verification.mjs alpha2 target/alpha2-ci
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const [prefix, ciDirectory] = process.argv.slice(2);
assert.match(prefix ?? '', /^[a-z0-9-]+$/, 'Supply the evidence prefix and downloaded CI artifact directory.');
assert.ok(ciDirectory);
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = file => hashBytes(readFileSync(file));
const json = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const inputs = [];
function load(file) {
  inputs.push({ file, sha256: hash(file) });
  return json(file);
}
function checked(file) {
  const record = load(file);
  assert.ok(record.checks.length > 0 && record.checks.every(check => check.passed === true), file);
  for (const item of [...record.documents ?? [], ...record.evidence ?? []]) {
    assert.equal(hash(item.file), item.sha256, item.file);
  }
  if (record.pageErrors) assert.deepEqual(record.pageErrors, []);
  if (record.dialogs) assert.deepEqual(record.dialogs, []);
  return record;
}
const version = json('package.json').version;
const packages = load('dist/packages.json');
const release = load(`output/playground/${prefix}-release-published.json`);
const downloads = load(`output/playground/${prefix}-public-downloads.json`);
const run = load(`output/playground/${prefix}-ci-run.json`);
assert.equal(release.tag_name, `v${version}`);
assert.equal(release.prerelease, true);
assert.equal(release.draft, false);
const releaseCommit = execFileSync('git', ['rev-parse', `${release.tag_name}^{commit}`], { encoding: 'utf8' }).trim();
assert.equal(releaseCommit, release.target_commitish);
assert.equal(run.status, 'completed');
assert.equal(run.conclusion, 'success');
assert.ok(run.jobs.length >= 2 && run.jobs.every(job => job.conclusion === 'success'));
const differences = execFileSync('git', ['diff', '--name-only', run.headSha, releaseCommit], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const browserChecks = ['tools/check-browser.py', 'tools/check-playground-browser.py', 'tools/check-startup-browser.py'];
assert.ok(differences.every(file => browserChecks.includes(file)), 'CI and release may differ only in the locally exercised browser checks.');
for (const item of packages) {
  assert.equal(hash(`dist/${item.filename}`), item.sha256);
  assert.equal(hash(`${ciDirectory}/dist/${item.filename}`), item.sha256);
}
assert.equal(downloads.assets.length, 4);
for (const item of downloads.assets) {
  assert.equal(item.unauthenticatedDownloadVerified, true);
  assert.equal(hash(`dist/${item.name}`), item.sha256);
  const asset = release.assets.find(candidate => candidate.name === item.name);
  assert.equal(asset?.digest, `sha256:${item.sha256}`);
  assert.equal(asset.size, item.bytes);
}
const blueprintHash = hash('playground/blueprint.json');
assert.equal(downloads.blueprint.sha256, blueprintHash);
assert.equal(downloads.blueprint.matchesLocalSource, true);
const localRuntime = checked('output/playground/local-verification.json');
const linuxRuntime = checked(`${ciDirectory}/output/playground/local-verification.json`);
for (const record of [localRuntime, linuxRuntime]) {
  assert.equal(record.blueprintSha256, blueprintHash);
  assert.deepEqual(record.archive, packages[0]);
  assert.equal(record.runtime.proPluginActive, false);
}
const localBrowser = checked('output/playground/local-browser-verification.json');
const publicBrowser = checked('output/playground/public-browser-verification.json');
for (const record of [localBrowser, publicBrowser]) assert.equal(record.blueprintSha256, blueprintHash);
assert.equal(publicBrowser.publicPlayground, true);
assert.equal(publicBrowser.storage.storage, 'temporary');
assert.equal(publicBrowser.storage.persistence, null);
const parity = publicBrowser.documents.map(item => {
  const local = localBrowser.documents.find(candidate => candidate.file === item.file.replace('/public-', '/local-'));
  assert.equal(local?.sha256, item.sha256);
  assert.equal(local.pages, item.pages);
  return { local: local.file, public: item.file, sha256: item.sha256, pages: item.pages };
});
const startup = checked('output/playground/startup-browser-verification.json');
assert.deepEqual(startup.packages, packages);
const pro = checked(`output/browser/${prefix}-wordpress-pro-verification.json`);
for (const variant of ['custom', 'saved']) assert.equal(hash(`output/browser/${prefix}-wordpress-pro-${variant}.pdf`), pro.pdfSha256);
const proBatchFile = `output/browser/${prefix}-wordpress-pro-batch.zip`;
copyFileSync('output/browser/wordpress-pro-batch.zip', proBatchFile);
const batchEntries = Object.entries(unzipSync(readFileSync(proBatchFile)));
assert.equal(batchEntries.length, 2);
assert.ok(batchEntries.every(([, bytes]) => Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-'));
const proEvidence = ['default.pdf', 'custom.pdf', 'saved.pdf', 'editor.png', 'mobile.png', 'batch.zip'].map(suffix => {
  const file = `output/browser/${prefix}-wordpress-pro-${suffix}`;
  return { file, sha256: hash(file) };
});
const automation = {};
for (const stem of ['woocommerce-hpos', 'customer-hpos', 'customer-legacy']) {
  const record = checked(`${ciDirectory}/output/automation/${stem}.json`);
  assert.equal(hash(`${ciDirectory}/output/automation/${stem}.pdf`), record.pdfSha256);
  if (record.packages) assert.deepEqual(record.packages, packages);
  automation[stem] = record;
}
assert.equal(automation['woocommerce-hpos'].unixPermissionsChecked, true);
const shopify = checked(`${ciDirectory}/output/shopify/verification.json`);
const deployment = checked('output/playground/docs-deployment-verification.json');
assert.equal(deployment.deployment.conclusion, 'success');
assert.equal(deployment.assets.find(asset => asset.url.endsWith('.pdf')).sha256, publicBrowser.documents[0].sha256);
const logFile = `output/playground/${prefix}-node-tests.log`;
const log = readFileSync(logFile, 'utf8');
const passed = Number(log.match(/^# pass (\d+)/m)?.[1]);
assert.ok(passed > 0);
assert.match(log, /^# fail 0$/m);
const result = {
  checkedAt: new Date().toISOString(),
  version,
  scope: 'Published WooCommerce preview, script readiness, public demo, and current Linux regression checks. Historical hosted and installed-Shopify evidence remains separate.',
  syntheticOnly: true,
  release: { url: release.html_url, tag: release.tag_name, commit: releaseCommit, publishedAt: release.published_at, prerelease: true },
  packages,
  publicDownloads: downloads,
  ci: {
    url: run.url, commit: run.headSha, conclusion: run.conclusion,
    jobs: run.jobs.map(({ name, conclusion, completedAt, url }) => ({ name, conclusion, completedAt, url })),
    releaseDifferences: differences,
    differenceScope: 'Browser test navigation waits only; locally exercised after this CI run. Runtime and packaged source are unchanged.',
    windowsLinuxArchivesIdentical: true,
  },
  sharedTests: { passed, failed: 0, logSha256: hash(logFile) },
  localRuntime, linuxRuntime, localBrowser, publicBrowser, documentParity: parity,
  scriptReadiness: startup,
  proBrowser: { ...pro, evidence: proEvidence, batchDocuments: batchEntries.map(([filename, bytes]) => ({ filename, sha256: hashBytes(bytes) })) },
  linuxAutomation: automation,
  linuxShopify: shopify,
  docsDeployment: deployment,
  limitations: [
    'The public demo runs the free plugin. Pro email attachments and customer downloads are not enabled there.',
    'The 32-item sample summary retains all items and totals across four pages; its final page contains a standalone closing section. No perfect-pagination claim.',
    'Browser checks use Chrome on synthetic fixtures. Safari, representative merchant hosts and real customer delivery remain unverified.',
    'The Linux email/customer checks use actual WordPress hooks and PDF bytes with test-only renderer transport; they do not verify a production HTTPS or mail provider.',
    'Paid purchase/update delivery, hosted Shopify installation and entitlement lifecycle, continuous operation, merchant pilots and marketplace review remain separate release gates.',
  ],
  inputs,
};
writeFileSync('docs/preview-release-verification.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ version, release: result.release.url, ci: run.conclusion, sharedTests: passed, publicBrowserChecks: publicBrowser.checks.length, scriptReadinessChecks: startup.checks.length, retained: 'docs/preview-release-verification.json' }, null, 2));
