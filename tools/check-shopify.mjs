// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { recoveryFixtureEnvironment } from './recovery-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'shopify/app');
const output = resolve(root, 'output/shopify');
mkdirSync(output, { recursive: true });
mkdirSync(resolve(root, 'target'), { recursive: true });
const env = { ...process.env, ...await recoveryFixtureEnvironment(root, 'webhook'), DATABASE_URL: `file:${resolve(root, 'target/webhook-test.sqlite').replaceAll('\\', '/')}`, NODE_ENV: 'production',
  SHOPIFY_API_KEY: 'synthetic-test-api-key', SHOPIFY_API_SECRET: 'synthetic-webhook-test-secret', FULLBLEED_PRIVACY_KEY: 'ab'.repeat(32), SHOPIFY_APP_URL: 'https://fullbleed-test.invalid', SCOPES: 'read_orders', FULLBLEED_DEV_STORE: '', OPT_OUT_INSTRUMENTATION: 'true' };
// Execute only local, pinned tools. Never use the running development app's database or credentials.
const generatedSchema = resolve(app, 'node_modules/.prisma/client/schema.prisma');
// Prisma's generated copy inserts blank lines around model constraints.
// Compare nonblank lines so harmless formatting cannot regenerate a DLL that
// the running Windows development app has loaded.
const normalize = value => value.replaceAll('\r\n', '\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
const clientCurrent = existsSync(generatedSchema) && normalize(readFileSync(generatedSchema, 'utf8')) === normalize(readFileSync(resolve(app, 'prisma/schema.prisma'), 'utf8'));
const jobs = [
  ...clientCurrent ? [] : [['schema', 'node_modules/prisma/build/index.js', 'generate']],
  ['migrations', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  ['recovery-fixture', 'test/setup-recovery.mjs'],
  ['route-types', 'node_modules/@react-router/dev/bin.js', 'typegen'],
  ['typecheck', 'node_modules/typescript/bin/tsc', '--noEmit'],
  ['lint', 'node_modules/eslint/bin/eslint.js', '--ignore-path', '.gitignore', '--cache', '--cache-location', './node_modules/.cache/eslint', '.'],
  ['build', 'node_modules/@react-router/dev/bin.js', 'build'],
  ['health', '--test', '--test-reporter=tap', 'test/health.test.mjs'],
  ['webhooks', '--test', '--test-reporter=tap', 'test/webhooks.test.mjs'],
  ['webhook-lifecycle', '--test', '--test-reporter=tap', 'test/webhook-lifecycle.test.mjs'],
  ['flow', '--test', '--test-reporter=tap', 'test/flow.test.mjs'],
  ['usage', '--test', '--test-reporter=tap', 'test/usage.test.mjs'],
  ['privacy', '--test', '--test-reporter=tap', 'test/privacy.test.mjs'],
  ['monitor', '--test', '--test-reporter=tap', 'test/monitor.test.mjs'],
  ['recovery', '--test', '--test-reporter=tap', 'test/recovery.test.mjs'],
];
const checks = clientCurrent ? [{ name: 'generated-client-matches-schema', exitCode: 0, passed: true }] : [];
const initialChecks = checks.length;
for (const [name, ...args] of jobs) {
  const run = spawnSync(process.execPath, args, { cwd: app, env, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  writeFileSync(resolve(output, `${name}.log`), (run.stdout || '') + (run.stderr || ''));
  checks.push({ name, exitCode: run.status, passed: run.status === 0 });
  console.log(`${name}: ${run.status === 0 ? 'passed' : 'FAILED'}`);
  if (run.status !== 0) { console.error((run.stdout || '') + (run.stderr || '')); break; }
}
const sha256 = file => createHash('sha256').update(readFileSync(resolve(app, file))).digest('hex');
const record = { checkedAt: new Date().toISOString(), node: process.version, checks, template: 'Shopify/shopify-app-template-react-router@93348fe7dbd8e1a33eea69e2bbba1990d136b0da', lockSha256: sha256('package-lock.json'), serverBuildSha256: sha256('build/server/index.js'), browserTested: false, liveBillingTested: false };
writeFileSync(resolve(output, 'verification.json'), JSON.stringify(record, null, 2) + '\n');
if (checks.length !== jobs.length + initialChecks || checks.some(check => !check.passed)) process.exitCode = 1;
