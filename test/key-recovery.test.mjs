// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRecoveryJournal } from '../shopify/recovery-journal.js';
import { createOperatorAudit } from '../shopify/operator-audit.js';
import { BINDING_PATH, KEY_NAMES, PRODUCTION, initializeKeyBinding, keyBundleFromEnvironment,
  railwayRecoveryApi, recoverProductionKeys } from '../tools/recover-production-keys.mjs';

const values = {
  FULLBLEED_MONITOR_TOKEN: '11'.repeat(32), FULLBLEED_PRIVACY_KEY: '22'.repeat(32),
  FULLBLEED_RECOVERY_KEY: '33'.repeat(32), FULLBLEED_RECOVERY_DATASET: '00000000-0000-4000-8000-000000000001',
  FULLBLEED_RECOVERY_ACCESS_KEY_ID: 'synthetic-access', FULLBLEED_RECOVERY_SECRET_ACCESS_KEY: 'synthetic-secret',
  FULLBLEED_RECOVERY_BUCKET: 'synthetic-bucket', FULLBLEED_RECOVERY_ENDPOINT: 'https://storage.example.test', FULLBLEED_RECOVERY_REGION: 'test',
};
const context = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'fullbleed-engine/fullbleed-commerce',
  GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'synthetic-operator', FULLBLEED_KEY_RECOVERY_MODE: 'verify', FULLBLEED_OPERATOR_REFERENCE: 'OPS-20261004-TEST' };
const failure = /^(?:Error: )?Production key recovery could not be verified\./;

async function fixture() {
  const objects = new Map(), calls = [];
  const store = {
    async read(path, max) { assert.ok(objects.has(path)); const body = objects.get(path); assert.ok(body.length <= max); return body; },
    async write(path, body) { if (objects.has(path)) throw Object.assign(new Error('exists'), { code: 'RECOVERY_OBJECT_EXISTS' }); objects.set(path, body); },
    async list(prefix) { return [...objects.keys()].filter(path => path.startsWith(prefix)); },
  };
  const journal = createRecoveryJournal({ store, key: values.FULLBLEED_RECOVERY_KEY, dataset: values.FULLBLEED_RECOVERY_DATASET });
  await journal.initialize(); await initializeKeyBinding(journal, values);
  const hosted = { ...values, SHOPIFY_API_SECRET: 'synthetic-unrelated-value' };
  const state = { projectToken: { projectId: PRODUCTION.projectId, environmentId: PRODUCTION.environmentId },
    serviceInstance: { serviceId: PRODUCTION.serviceId, environmentId: PRODUCTION.environmentId, activeDeployments: [] } };
  const api = async (query, input) => {
    calls.push({ query, input });
    if (query.includes('query RecoveryState')) return structuredClone(state);
    if (query.includes('query RecoveryValues')) return { variables: { ...hosted } };
    if (query.includes('mutation RestoreMissingKeys')) {
      assert.deepEqual(Object.keys(input), ['input']);
      assert.equal(input.input.skipDeploys, true); assert.equal(input.input.replace, false);
      for (const [key, value] of Object.entries(PRODUCTION)) assert.equal(input.input[key], value);
      Object.assign(hosted, input.input.variables); return { variableCollectionUpsert: true };
    }
    throw new Error('Unexpected provider operation');
  };
  return { store, journal, hosted, state, api, calls, objects, env: { ...values, ...context } };
}

test('independent verification authenticates every key, with receipts and no host mutations', async () => {
  const f = await fixture();
  const result = await recoverProductionKeys(f);
  assert.deepEqual({ ...result, auditId: undefined }, { status: 'verified', mode: 'verify', restored: [], keyCount: 9,
    activeDeployments: 0, openedMerchantDatabase: false, auditId: undefined });
  assert.equal(f.calls.some(call => call.query.includes('mutation')), false);
  const receipts = await createOperatorAudit({ journal: f.journal }).entries();
  assert.equal(receipts.length, 1); assert.equal(receipts[0].outcome, 'completed');
  assert.equal(receipts[0].started.operator, 'synthetic-operator');
  assert.ok([...f.objects.keys()].every(key => key === 'dataset.bin' || key === BINDING_PATH || key.startsWith('operator/')));
});

test('restore fills missing and empty values only, preserving every unrelated setting', async () => {
  const f = await fixture(); delete f.hosted.FULLBLEED_PRIVACY_KEY; f.hosted.FULLBLEED_RECOVERY_SECRET_ACCESS_KEY = '';
  f.env.FULLBLEED_KEY_RECOVERY_MODE = 'restore-missing';
  const result = await recoverProductionKeys(f);
  assert.deepEqual(result.restored, ['FULLBLEED_PRIVACY_KEY', 'FULLBLEED_RECOVERY_SECRET_ACCESS_KEY']);
  assert.deepEqual(f.calls.find(call => call.query.includes('mutation')).input.input.variables,
    { FULLBLEED_PRIVACY_KEY: values.FULLBLEED_PRIVACY_KEY, FULLBLEED_RECOVERY_SECRET_ACCESS_KEY: values.FULLBLEED_RECOVERY_SECRET_ACCESS_KEY });
  assert.deepEqual(f.hosted, { ...values, SHOPIFY_API_SECRET: 'synthetic-unrelated-value' });
  const retry = await recoverProductionKeys(f);
  assert.deepEqual(retry.restored, []); assert.equal(f.calls.filter(call => call.query.includes('mutation')).length, 1);
});

test('verify refuses missing keys; restore refuses any conflicting existing value', async () => {
  for (const name of KEY_NAMES) {
    const f = await fixture(); delete f.hosted[name];
    await assert.rejects(recoverProductionKeys(f), failure);
    f.hosted[name] = 'unexpected'; f.env.FULLBLEED_KEY_RECOVERY_MODE = 'restore-missing';
    await assert.rejects(recoverProductionKeys(f), failure);
    assert.equal(f.calls.some(call => call.query.includes('mutation')), false);
  }
});

test('control record binds privacy, monitoring, bucket credentials and dataset; it is never replaced', async () => {
  for (const [name, replacement] of [['FULLBLEED_PRIVACY_KEY', '44'.repeat(32)], ['FULLBLEED_MONITOR_TOKEN', '55'.repeat(32)],
    ['FULLBLEED_RECOVERY_KEY', '66'.repeat(32)], ['FULLBLEED_RECOVERY_SECRET_ACCESS_KEY', 'another-secret'],
    ['FULLBLEED_RECOVERY_DATASET', '00000000-0000-4000-8000-000000000002']]) {
    const f = await fixture(); const before = Buffer.from(f.objects.get(BINDING_PATH)); f.env[name] = replacement;
    await assert.rejects(recoverProductionKeys(f), failure);
    await assert.rejects(initializeKeyBinding(f.journal, keyBundleFromEnvironment(f.env)));
    assert.deepEqual(f.objects.get(BINDING_PATH), before); assert.equal(f.calls.length, 0);
  }
  const f = await fixture(); const before = Buffer.from(f.objects.get(BINDING_PATH));
  await initializeKeyBinding(f.journal, values); assert.deepEqual(f.objects.get(BINDING_PATH), before);
});

test('wrong workflow, branch, repository, mode and unsafe process settings are refused before access', async () => {
  for (const [name, value] of [['GITHUB_ACTIONS', 'false'], ['GITHUB_EVENT_NAME', 'pull_request'], ['GITHUB_REF', 'refs/tags/main'],
    ['GITHUB_REPOSITORY', 'attacker/fork'], ['GITHUB_ACTOR', 'bad\nactor'], ['FULLBLEED_KEY_RECOVERY_MODE', 'rotate'],
    ['FULLBLEED_OPERATOR_REFERENCE', 'customer information'], ['FULLBLEED_RECOVERY_DIRECTORY', '/tmp/storage'], ['NODE_OPTIONS', '--require bad']]) {
    const f = await fixture(); f.env[name] = value;
    await assert.rejects(recoverProductionKeys(f), failure); assert.equal(f.calls.length, 0);
    assert.equal([...f.objects.keys()].some(key => key.startsWith('operator/')), false);
  }
});

test('wrong token scope, wrong service or an active deployment prevents mutation', async () => {
  for (const modify of [f => f.state.projectToken.projectId = 'staging', f => f.state.projectToken.environmentId = 'staging',
    f => f.state.serviceInstance.serviceId = 'staging', f => f.state.serviceInstance.environmentId = 'staging',
    f => f.state.serviceInstance.activeDeployments.push({ id: 'running' })]) {
    const f = await fixture(); f.env.FULLBLEED_KEY_RECOVERY_MODE = 'restore-missing'; delete f.hosted.FULLBLEED_PRIVACY_KEY; modify(f);
    await assert.rejects(recoverProductionKeys(f), failure); assert.equal(f.calls.some(call => call.query.includes('mutation')), false);
  }
});

test('a deployment or conflicting value appearing immediately before restore prevents mutation', async () => {
  for (const modify of [f => f.state.serviceInstance.activeDeployments.push({ id: 'new' }), f => f.hosted.FULLBLEED_PRIVACY_KEY = 'changed']) {
    const f = await fixture(); f.env.FULLBLEED_KEY_RECOVERY_MODE = 'restore-missing'; delete f.hosted.FULLBLEED_PRIVACY_KEY;
    const api = f.api; let reads = 0;
    f.api = async (...args) => { if (args[0].includes('query RecoveryState') && ++reads === 2) modify(f); return api(...args); };
    await assert.rejects(recoverProductionKeys(f), failure); assert.equal(f.calls.some(call => call.query.includes('mutation')), false);
  }
});

test('missing, modified or unreadable binding fails closed without host access', async () => {
  for (const modify of [f => f.objects.delete(BINDING_PATH), f => f.objects.get(BINDING_PATH).fill(0),
    f => f.objects.delete('dataset.bin')]) {
    const f = await fixture(); modify(f);
    await assert.rejects(recoverProductionKeys(f), failure); assert.equal(f.calls.length, 0);
  }
});

test('unrecordable operator access stops before host operations', async () => {
  const f = await fixture(); f.store.write = async () => { throw new Error('synthetic-secret'); };
  await assert.rejects(recoverProductionKeys(f), failure); assert.equal(f.calls.length, 0);
});

test('lost mutation acknowledgement keeps restored values and permits an idempotent verified retry', async () => {
  const f = await fixture(); f.env.FULLBLEED_KEY_RECOVERY_MODE = 'restore-missing'; delete f.hosted.FULLBLEED_PRIVACY_KEY;
  const api = f.api;
  f.api = async (...args) => { const result = await api(...args); if (args[0].includes('mutation')) throw new Error(values.FULLBLEED_PRIVACY_KEY); return result; };
  await assert.rejects(recoverProductionKeys(f), failure);
  assert.equal(f.hosted.FULLBLEED_PRIVACY_KEY, values.FULLBLEED_PRIVACY_KEY);
  f.api = api; assert.deepEqual((await recoverProductionKeys(f)).restored, []);
  const receipts = await createOperatorAudit({ journal: f.journal }).entries();
  assert.deepEqual(receipts.map(receipt => receipt.outcome).sort(), ['completed', 'failed']);
});

test('a successful write response without matching readback is not reported as recovery', async () => {
  const f = await fixture(); f.env.FULLBLEED_KEY_RECOVERY_MODE = 'restore-missing'; delete f.hosted.FULLBLEED_PRIVACY_KEY;
  const api = f.api; f.api = async (...args) => args[0].includes('mutation') ? { variableCollectionUpsert: true } : api(...args);
  await assert.rejects(recoverProductionKeys(f), failure);
});

test('provider transport pins HTTPS, rejects redirects and limits response size without leaking errors', async () => {
  const token = 'synthetic-token-value-000000'; let request;
  const api = railwayRecoveryApi(token, async (url, options) => { request = { url, options }; return Response.json({ data: { ok: true } }); });
  assert.deepEqual(await api('query { ok }'), { ok: true });
  assert.equal(request.url, 'https://backboard.railway.com/graphql/v2');
  assert.equal(request.options.redirect, 'error'); assert.equal(request.options.headers['Project-Access-Token'], token);
  assert.equal(request.options.headers.Authorization, undefined);
  for (const fetcher of [async () => { throw new Error(token); }, async () => Response.json({ errors: [{ message: token }] }),
    async () => new Response(token, { status: 401 }), async () => Response.json({ data: { text: 'x'.repeat(524288) } }),
    async () => new Response(token, { headers: { 'Content-Type': 'text/html' } })]) {
    await assert.rejects(railwayRecoveryApi(token, fetcher)('query { ok }'), error => failure.test(error.message) && !error.message.includes(token));
  }
});

test('manual recovery workflow exposes individually named secrets only in its recovery step', async () => {
  const workflow = await readFile(new URL('../.github/workflows/recover-production-keys.yml', import.meta.url), 'utf8');
  assert.match(workflow, /environment: commerce-production-recovery/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request|schedule:|upload-artifact|actions\/cache|secrets: inherit/);
  assert.ok(workflow.indexOf('npm ci --ignore-scripts') < workflow.indexOf('secrets.'));
  assert.equal((workflow.match(/\buses:/g) || []).length, (workflow.match(/\buses: [^\s]+@[a-f0-9]{40}/g) || []).length);
  assert.match(workflow, /contents: read/);
  for (const name of [...KEY_NAMES, 'RAILWAY_RECOVERY_TOKEN']) assert.equal((workflow.match(new RegExp(`secrets\\.${name} \\}\\}`, 'g')) || []).length, 1);
});
