import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { createClient } from '../automation/create-client.mjs';

test('renderer connection provisioning separates the token from its mountable hash and never overwrites', () => {
  const root = mkdtempSync(join(tmpdir(), 'fullbleed-client-test-'));
  try {
    const directory = join(root, 'store');
    const result = createClient(directory, 'cedar-form');
    const token = readFileSync(result.tokenFile, 'utf8').trim();
    assert.match(token, /^[a-zA-Z0-9_-]{43}$/);
    const clients = JSON.parse(readFileSync(result.clientsFile, 'utf8'));
    assert.deepEqual(clients, [{ site: 'cedar-form', tokenSha256: createHash('sha256').update(token).digest('hex') }]);
    assert.ok(!JSON.stringify(result).includes(token));
    assert.throws(() => createClient(directory, 'another-store'), { code: 'EEXIST' });
    assert.equal(readFileSync(result.tokenFile, 'utf8').trim(), token);
    if (process.platform !== 'win32') {
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(statSync(result.tokenFile).mode & 0o777, 0o600);
      assert.equal(statSync(result.clientsFile).mode & 0o777, 0o644);
      const alias = join(root, 'alias');
      symlinkSync(directory, alias);
      assert.throws(() => createClient(alias, 'another-store'), { code: 'EEXIST' });
    }
    assert.throws(() => createClient(join(root, 'invalid'), 'has spaces'), TypeError);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('fullbleed-client-test-'));
    rmSync(root, { recursive: true, force: true });
  }
});
