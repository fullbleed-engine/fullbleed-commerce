// SPDX-License-Identifier: MIT
// Key recovery only: never opens a merchant database or reads a backup object.
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRecoveryJournal } from '../shopify/recovery-journal.js';
import { createOperatorAudit } from '../shopify/operator-audit.js';

export const PRODUCTION = Object.freeze({
  projectId: '6337f5dc-6602-48a3-acba-0286271471ea',
  environmentId: '432435d8-c0d2-4ad5-80ae-0c1444e7e1d1',
  serviceId: 'b9f4dc6e-5435-4718-80d4-2c766435b11d',
});
export const KEY_NAMES = Object.freeze([
  'FULLBLEED_MONITOR_TOKEN', 'FULLBLEED_PRIVACY_KEY', 'FULLBLEED_RECOVERY_ACCESS_KEY_ID',
  'FULLBLEED_RECOVERY_BUCKET', 'FULLBLEED_RECOVERY_DATASET', 'FULLBLEED_RECOVERY_ENDPOINT',
  'FULLBLEED_RECOVERY_KEY', 'FULLBLEED_RECOVERY_REGION', 'FULLBLEED_RECOVERY_SECRET_ACCESS_KEY',
]);
export const BINDING_PATH = 'control/key-recovery-v1.bin';
const API_URL = 'https://backboard.railway.com/graphql/v2';
const FAILURE = 'Production key recovery could not be verified. Keep the service offline and inspect the private incident record.';
const fail = () => new Error(FAILURE);
const digest = values => createHash('sha256').update(JSON.stringify(KEY_NAMES.map(name => [name, values[name]]))).digest('hex');
const ids = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function keyBundleFromEnvironment(env) {
  const values = Object.fromEntries(KEY_NAMES.map(name => [name, env[name]]));
  if (KEY_NAMES.some(name => typeof values[name] !== 'string' || !values[name] || values[name].length > 4096 || /[\r\n\0]/.test(values[name])) ||
      !['FULLBLEED_MONITOR_TOKEN', 'FULLBLEED_PRIVACY_KEY', 'FULLBLEED_RECOVERY_KEY'].every(name => /^[a-f0-9]{64}$/.test(values[name])) ||
      new Set(['FULLBLEED_MONITOR_TOKEN', 'FULLBLEED_PRIVACY_KEY', 'FULLBLEED_RECOVERY_KEY'].map(name => values[name])).size !== 3 ||
      !ids.test(values.FULLBLEED_RECOVERY_DATASET)) throw fail();
  let url;
  try { url = new URL(values.FULLBLEED_RECOVERY_ENDPOINT); } catch { throw fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail();
  return values;
}

export async function verifyKeyBinding(journal, values) {
  await journal.verify();
  const binding = JSON.parse(journal.codec.open(BINDING_PATH, await journal.store.read(BINDING_PATH, 4096)));
  if (Object.keys(binding || {}).sort().join(',') !== 'createdAt,dataset,environmentId,format,keysDigest,projectId,serviceId' ||
      binding.format !== 'fullbleed-key-recovery-v1' || binding.dataset !== journal.dataset ||
      !Object.entries(PRODUCTION).every(([key, value]) => binding[key] === value) ||
      !Number.isFinite(Date.parse(binding.createdAt)) || !/^[a-f0-9]{64}$/.test(binding.keysDigest || '') ||
      !timingSafeEqual(Buffer.from(binding.keysDigest, 'hex'), Buffer.from(digest(values), 'hex'))) throw fail();
}

// Run once from verified existing host values, before the independent rehearsal.
// An existing binding is authenticated, never replaced or silently regenerated.
export async function initializeKeyBinding(journal, values) {
  keyBundleFromEnvironment(values);
  await journal.verify();
  const record = { format: 'fullbleed-key-recovery-v1', ...PRODUCTION, dataset: journal.dataset,
    createdAt: new Date().toISOString(), keysDigest: digest(values) };
  try { await journal.store.write(BINDING_PATH, journal.codec.seal(BINDING_PATH, Buffer.from(JSON.stringify(record)))); }
  catch (error) { if (error.code !== 'RECOVERY_OBJECT_EXISTS') throw error; }
  await verifyKeyBinding(journal, values);
}

// Provider response bodies, URLs and exception messages must never reach logs.
export function railwayRecoveryApi(token, fetcher = fetch) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || /[\s\0]/.test(token)) throw fail();
  return async (query, variables = {}) => {
    let reader;
    try {
      const response = await fetcher(API_URL, { method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Project-Access-Token': token, 'User-Agent': 'Fullbleed-Commerce-Key-Recovery/1' },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000) });
      if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) throw fail();
      reader = response.body?.getReader();
      if (!reader) throw fail();
      const chunks = []; let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 512 * 1024) throw fail();
        chunks.push(value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result.errors?.length || !result.data || typeof result.data !== 'object') throw fail();
      return result.data;
    } catch { throw fail(); }
    finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  };
}

async function inspect(api) {
  const state = await api(`query RecoveryState($environmentId:String!,$serviceId:String!) {
    projectToken { projectId environmentId }
    serviceInstance(environmentId:$environmentId,serviceId:$serviceId) {
      serviceId environmentId activeDeployments { id }
    }
  }`, { environmentId: PRODUCTION.environmentId, serviceId: PRODUCTION.serviceId });
  if (state.projectToken?.projectId !== PRODUCTION.projectId || state.projectToken?.environmentId !== PRODUCTION.environmentId ||
      state.serviceInstance?.serviceId !== PRODUCTION.serviceId || state.serviceInstance?.environmentId !== PRODUCTION.environmentId ||
      !Array.isArray(state.serviceInstance?.activeDeployments) || state.serviceInstance.activeDeployments.length) throw fail();
  const { variables } = await api(`query RecoveryValues($projectId:String!,$environmentId:String!,$serviceId:String!) {
    variables(projectId:$projectId,environmentId:$environmentId,serviceId:$serviceId)
  }`, PRODUCTION);
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw fail();
  return variables;
}

function compare(hosted, values) {
  const missing = [];
  for (const name of KEY_NAMES) {
    if (hosted[name] === undefined || hosted[name] === '') missing.push(name);
    else if (hosted[name] !== values[name]) throw fail(); // No rotation or overwrite.
  }
  return missing;
}

export async function recoverProductionKeys({ env = process.env, api, store } = {}) {
  try {
    if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
        env.GITHUB_REPOSITORY !== 'fullbleed-engine/fullbleed-commerce' || env.GITHUB_REF !== 'refs/heads/main' ||
        !/^[a-z][a-z0-9-]{1,38}$/.test(env.GITHUB_ACTOR || '') ||
        !['verify', 'restore-missing'].includes(env.FULLBLEED_KEY_RECOVERY_MODE) ||
        !/^(?:OPS|INC)-\d{8}-[A-Z0-9]{3,12}$/.test(env.FULLBLEED_OPERATOR_REFERENCE || '') ||
        env.FULLBLEED_RECOVERY_DIRECTORY || env.NODE_OPTIONS) throw fail();
    const values = keyBundleFromEnvironment(env);
    if (!api) api = railwayRecoveryApi(env.RAILWAY_RECOVERY_TOKEN);
    if (!store) {
      const { recoveryStoreFromEnvironment } = await import('../shopify/app/scripts/recovery-store.mjs');
      store = await recoveryStoreFromEnvironment(values);
    }
    const journal = createRecoveryJournal({ store, key: values.FULLBLEED_RECOVERY_KEY, dataset: values.FULLBLEED_RECOVERY_DATASET });
    await verifyKeyBinding(journal, values);
    const audit = createOperatorAudit({ journal });
    const context = { operator: env.GITHUB_ACTOR, purpose: 'recovery', operation: 'console.railway',
      reference: env.FULLBLEED_OPERATOR_REFERENCE };
    const { id, result } = await audit.run(context, async () => {
      const initial = await inspect(api);
      const missing = compare(initial, values);
      if (env.FULLBLEED_KEY_RECOVERY_MODE === 'verify' && missing.length) throw fail();
      if (missing.length) {
        // Recheck immediately before mutation. Operations require an exclusive
        // attended window; this is not a lock against another provider operator.
        const second = compare(await inspect(api), values);
        if (JSON.stringify(second) !== JSON.stringify(missing)) throw fail();
        const result = await api(`mutation RestoreMissingKeys($input:VariableCollectionUpsertInput!) {
          variableCollectionUpsert(input:$input)
        }`, { input: { ...PRODUCTION, replace: false, skipDeploys: true,
          variables: Object.fromEntries(missing.map(name => [name, values[name]])) } });
        if (result.variableCollectionUpsert !== true) throw fail();
      }
      if (compare(await inspect(api), values).length) throw fail();
      await verifyKeyBinding(journal, values);
      return { status: 'verified', mode: env.FULLBLEED_KEY_RECOVERY_MODE, restored: missing,
        keyCount: KEY_NAMES.length, activeDeployments: 0, openedMerchantDatabase: false };
    });
    return { ...result, auditId: id };
  } catch { throw fail(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await recoverProductionKeys())); }
  catch { console.error(FAILURE); process.exitCode = 1; }
}
