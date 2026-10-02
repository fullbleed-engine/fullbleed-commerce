import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequestHandler } from 'react-router';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Run only against the isolated synthetic webhook database.');
const handler = createRequestHandler(await import('../build/server/index.js'), 'production');

test('public readiness confirms migrated storage without exposing merchant data', async () => {
  const response = await handler(new Request('https://fullbleed-test.invalid/health'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('empty and inaccessible databases fail readiness with a generic 503', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fullbleed-health-'));
  for (const filename of [join(directory, 'empty.sqlite'), join(directory, 'missing', 'inaccessible.sqlite')]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { createRequestHandler } from 'react-router';
      const handler = createRequestHandler(await import('./build/server/index.js'), 'production');
      const response = await handler(new Request('https://fullbleed-test.invalid/health'));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { status: 'unavailable' });
      process.exit(0);
    `], { env: { ...process.env, DATABASE_URL: `file:${filename.replaceAll('\\', '/')}` }, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
