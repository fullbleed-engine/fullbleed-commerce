// SPDX-License-Identifier: MIT
// Read-only operator probe. Public CI output deliberately excludes queue counts.
import { pathToFileURL } from 'node:url';

const messages = {
  configuration: 'Monitoring URL or token is not configured correctly.',
  unavailable: 'Fullbleed monitoring is unavailable. Check hosting, storage and monitoring credentials.',
  invalid: 'Fullbleed returned an invalid or stale monitoring response.',
  privacy_due: 'A privacy response deadline needs attention. Open the app privacy queue.',
  privacy_key: 'The privacy queue has a key mismatch. Restore the correct privacy key before processing requests.',
  backup_disabled: 'Automatic backups are disabled. Enable the backup schedule before continuous service.',
  backup_missing: 'No verified backup is available. Check the backup worker and recovery storage.',
  backup_stale: 'The latest verified backup is over 26 hours old. Check the backup worker and recovery storage.',
};
class MonitorError extends Error {
  constructor(code) { super(messages[code]); this.code = code; }
}

async function readJson(response) {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') || '') ||
      !response.headers.get('Cache-Control')?.includes('no-store')) throw new MonitorError('invalid');
  const reader = response.body?.getReader();
  if (!reader) throw new MonitorError('invalid');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new MonitorError('invalid'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof MonitorError) throw error;
    throw new MonitorError('invalid');
  } finally { reader.releaseLock(); }
}

export async function checkMonitor({ url, token, fetcher = fetch, now = Date.now }) {
  let target;
  try { target = new URL(url); } catch { throw new MonitorError('configuration'); }
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash ||
      target.pathname !== '/internal/monitor' || !/^[a-f0-9]{64}$/i.test(token || '')) throw new MonitorError('configuration');
  const request = async (path, headers) => {
    try {
      const response = await fetcher(new URL(path, target), {
        headers, redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store',
      });
      return { response, data: await readJson(response) };
    } catch (error) {
      if (error instanceof MonitorError) throw error;
      // Fetch errors or response bodies can include URLs or private information.
      throw new MonitorError('unavailable');
    }
  };
  const health = await request('/health', { Accept: 'application/json' });
  if (health.response.status !== 200 || health.data?.status !== 'ok') throw new MonitorError('unavailable');
  const { response, data } = await request(target.pathname, { Accept: 'application/json', Authorization: `Bearer ${token}` });
  if (![200, 503].includes(response.status) || !['ok', 'attention'].includes(data?.status)) throw new MonitorError('unavailable');
  const checkedAt = Date.parse(data.checkedAt);
  if (typeof data.checkedAt !== 'string' || !Number.isFinite(checkedAt) || Math.abs(now() - checkedAt) > 5 * 60000 ||
      !['pending', 'overdue', 'dueWithin48Hours', 'keyMismatch'].every(key => Number.isSafeInteger(data.privacy?.[key]) && data.privacy[key] >= 0)) {
    throw new MonitorError('invalid');
  }
  if (data.privacy.keyMismatch > 0) throw new MonitorError('privacy_key');
  if (data.privacy.dueWithin48Hours > 0 || data.privacy.overdue > 0) throw new MonitorError('privacy_due');
  const backups = data.backups;
  if (!['fresh', 'missing', 'unverified', 'stale', 'disabled'].includes(backups?.status)) throw new MonitorError('invalid');
  if (['disabled', 'missing'].includes(backups.status)) {
    if (backups.snapshotAt !== null || backups.ageSeconds !== null) throw new MonitorError('invalid');
    throw new MonitorError(backups.status === 'disabled' ? 'backup_disabled' : 'backup_missing');
  }
  const snapshotAt = Date.parse(backups.snapshotAt);
  if (typeof backups.snapshotAt !== 'string' || !Number.isFinite(snapshotAt) || snapshotAt > checkedAt + 5 * 60000 ||
      !Number.isSafeInteger(backups.ageSeconds) || backups.ageSeconds < 0 ||
      backups.ageSeconds !== Math.max(0, Math.floor((checkedAt - snapshotAt) / 1000))) throw new MonitorError('invalid');
  if (backups.status === 'unverified') throw new MonitorError('backup_missing');
  if (backups.ageSeconds > 26 * 3600) throw new MonitorError('backup_stale');
  if (backups.status !== 'fresh') throw new MonitorError('invalid');
  if (response.status !== 200 || data.status !== 'ok') throw new MonitorError('invalid');
  return { status: 'ok' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkMonitor({ url: process.env.FULLBLEED_MONITOR_URL, token: process.env.FULLBLEED_MONITOR_TOKEN });
    console.log('Fullbleed availability, privacy and backup checks passed.');
  } catch (error) {
    console.error(error instanceof MonitorError ? error.message : messages.unavailable);
    process.exitCode = 1;
  }
}
