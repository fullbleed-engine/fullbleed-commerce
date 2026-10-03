// SPDX-License-Identifier: MIT
// Create a new private directory; never overwrite an existing connection.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createClient(directory, site) {
  if (!directory || !/^[a-zA-Z0-9_-]{3,80}$/.test(site ?? '')) throw new TypeError('Supply a new directory and a site ID of 3–80 letters, digits, hyphens or underscores.');
  const root = resolve(directory);
  mkdirSync(root, { mode: 0o700 }); // EEXIST is intentional, including symlinks.
  const token = randomBytes(32).toString('base64url');
  const clientsFile = join(root, 'clients.json');
  const tokenFile = join(root, 'wordpress-token.txt');
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600, flag: 'wx' });
  // Hashes are not bearer credentials. Read access allows a non-root container
  // to mount this file; the parent remains private and the raw token is separate.
  writeFileSync(clientsFile, `${JSON.stringify([{ site, tokenSha256: createHash('sha256').update(token).digest('hex') }], null, 2)}\n`, { mode: 0o644, flag: 'wx' });
  chmodSync(clientsFile, 0o644); // Also works when the operator uses umask 077.
  return { site, clientsFile, tokenFile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [directory, site, ...extra] = process.argv.slice(2);
    if (extra.length) throw new TypeError('Usage: node automation/create-client.mjs NEW_DIRECTORY SITE_ID');
    console.log(JSON.stringify(createClient(directory, site), null, 2));
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Choose a new private directory. Existing connections are never overwritten.' : error.message);
    process.exitCode = 1;
  }
}
