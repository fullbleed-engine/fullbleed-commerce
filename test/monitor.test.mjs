import assert from 'node:assert/strict';
import test from 'node:test';
import { checkMonitor } from '../tools/check-monitor.mjs';

const token = 'cd'.repeat(32);
const url = 'https://synthetic-monitor.invalid/internal/monitor';
const now = Date.now();
const healthy = () => ({ status: 'ok', checkedAt: new Date(now).toISOString(), privacy: { pending: 1, overdue: 0, dueWithin48Hours: 0, keyMismatch: 0 }, backups: { status: 'fresh', snapshotAt: new Date(now - 3600000).toISOString(), ageSeconds: 3600 } });
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const transport = (body, status = 200) => async target => target.pathname === '/health' ? json({ status: 'ok' }) : json(body, status);
const expected = code => error => error.code === code && !error.message.includes(token) && !error.message.includes('private@example.invalid');

test('monitor probes public readiness before sending its scoped token to the private endpoint', async () => {
  const calls = [];
  const result = await checkMonitor({ url, token, now: () => now, fetcher: async (target, options) => {
    calls.push({ path: target.pathname, options });
    return json(target.pathname === '/health' ? { status: 'ok' } : healthy());
  } });
  assert.deepEqual(result, { status: 'ok' });
  assert.deepEqual(calls.map(call => call.path), ['/health', '/internal/monitor']);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${token}`);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('invalid destinations and tokens never send a credential', async () => {
  for (const candidate of ['http://synthetic-monitor.invalid/internal/monitor', `${url}?token=anything`, `${url}#fragment`, url.replace('/internal/monitor', '/elsewhere'), url.replace('https://', 'https://user:password@')]) {
    await assert.rejects(checkMonitor({ url: candidate, token, fetcher: () => assert.fail('No request permitted.') }), expected('configuration'));
  }
  await assert.rejects(checkMonitor({ url, token: 'short', fetcher: () => assert.fail('No request permitted.') }), expected('configuration'));
});

test('privacy deadlines and key mismatches fail the probe even if the server labels them healthy', async () => {
  for (const [key, code] of [['dueWithin48Hours', 'privacy_due'], ['overdue', 'privacy_due'], ['keyMismatch', 'privacy_key']]) {
    const body = healthy(); body.privacy[key] = 1;
    for (const status of [200, 503]) {
      body.status = status === 200 ? 'ok' : 'attention';
      await assert.rejects(checkMonitor({ url, token, now: () => now, fetcher: transport(body, status) }), expected(code));
    }
  }
});

test('stale or malformed responses cannot report a healthy service', async () => {
  const stale = healthy(); stale.checkedAt = new Date(now - 6 * 60000).toISOString();
  const malformed = healthy(); malformed.privacy.pending = '1';
  for (const body of [stale, malformed, { ...healthy(), status: 'attention' }]) {
    await assert.rejects(checkMonitor({ url, token, now: () => now, fetcher: transport(body) }), expected('invalid'));
  }
  for (const response of [
    new Response('<html>private@example.invalid</html>', { headers: { 'Content-Type': 'text/html' } }),
    Response.json(healthy()),
    json({ ...healthy(), extra: 'x'.repeat(17000) }),
  ]) {
    await assert.rejects(checkMonitor({ url, token, fetcher: async () => response }), expected('invalid'));
  }
});

test('outage, authorization and transport failures expose only safe operational messages', async () => {
  await assert.rejects(checkMonitor({ url, token, fetcher: async () => json({ status: 'unavailable' }, 503) }), expected('unavailable'));
  await assert.rejects(checkMonitor({ url, token, fetcher: transport({ status: 'unauthorized', detail: 'private@example.invalid' }, 401) }), expected('unavailable'));
  await assert.rejects(checkMonitor({ url, token, fetcher: async () => { throw new Error(`Connection failed: ${token} private@example.invalid`); } }), expected('unavailable'));
});

test('missing, unverified, disabled and stale backups fail regardless of the server health label', async () => {
  for (const status of [200, 503]) {
    for (const [backupStatus, code] of [['disabled', 'backup_disabled'], ['missing', 'backup_missing'], ['unverified', 'backup_missing'], ['stale', 'backup_stale']]) {
      const body = healthy();
      body.status = status === 200 ? 'ok' : 'attention';
      body.backups = ['disabled', 'missing'].includes(backupStatus)
        ? { status: backupStatus, snapshotAt: null, ageSeconds: null }
        : { status: backupStatus, snapshotAt: new Date(now - 27 * 3600000).toISOString(), ageSeconds: 27 * 3600 };
      await assert.rejects(checkMonitor({ url, token, now: () => now, fetcher: transport(body, status) }), expected(code));
    }
  }
  const body = healthy(); body.backups.snapshotAt = new Date(now - 27 * 3600000).toISOString(); body.backups.ageSeconds = 27 * 3600;
  await assert.rejects(checkMonitor({ url, token, now: () => now, fetcher: transport(body) }), expected('backup_stale'));
});

test('missing or contradictory backup evidence cannot produce a successful probe', async () => {
  for (const backups of [undefined, {}, { ...healthy().backups, ageSeconds: '3600' },
    { ...healthy().backups, ageSeconds: 0 }, { ...healthy().backups, snapshotAt: new Date(now + 10 * 60000).toISOString(), ageSeconds: 0 },
    { ...healthy().backups, status: 'disabled' }, { ...healthy().backups, status: 'stale' }]) {
    await assert.rejects(checkMonitor({ url, token, now: () => now, fetcher: transport({ ...healthy(), backups }) }), expected('invalid'));
  }
});
