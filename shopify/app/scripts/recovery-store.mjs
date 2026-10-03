// SPDX-License-Identifier: MIT
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, open, readFile, readdir, lstat, realpath, link, unlink } from 'node:fs/promises';
import { isAbsolute, join, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { recoveryFailure } from '../../recovery-journal.js';

const validKey = key => typeof key === 'string' && /^[a-z0-9][a-z0-9./-]*$/.test(key) && !key.split('/').some(part => part === '.' || part === '..');
const conflict = () => Object.assign(recoveryFailure(), { code: 'RECOVERY_OBJECT_EXISTS' });

// Local rehearsals only. Railway uses a bucket independent of the SQLite volume.
export async function fileRecoveryStore(directory) {
  if (!isAbsolute(directory)) throw recoveryFailure();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory);
  async function pathFor(key, create = false) {
    if (!validKey(key)) throw recoveryFailure();
    const path = join(root, key);
    if (create) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const parent = await realpath(dirname(path));
    if (parent !== root && !parent.startsWith(root + sep)) throw recoveryFailure();
    return path;
  }
  async function syncDirectory(path) {
    if (process.platform === 'win32') return; // Windows durability is exercised in Linux CI.
    const handle = await open(path, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  return {
    async read(key, maxBytes) {
      try {
        const path = await pathFor(key);
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw recoveryFailure();
        const body = await readFile(path);
        if (body.length > maxBytes) throw recoveryFailure();
        return body;
      } catch { throw recoveryFailure(); }
    },
    async write(key, body) {
      const path = await pathFor(key, true);
      const temporary = join(dirname(path), `.partial-${randomUUID()}`);
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(body); await handle.sync(); await handle.close(); handle = null;
        await link(temporary, path); // Publish an entire object, without replacement.
        await syncDirectory(dirname(path));
      } catch (error) {
        if (error.code === 'EEXIST') throw conflict();
        throw recoveryFailure();
      } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
    },
    async list(prefix) {
      if (!validKey(prefix) || !prefix.endsWith('/')) throw recoveryFailure();
      const directory = await pathFor(prefix + 'placeholder', true).then(dirname);
      const result = [];
      async function walk(directory, path) {
        for (const item of await readdir(directory, { withFileTypes: true })) {
          if (item.name.startsWith('.partial-')) continue;
          if (item.isDirectory()) await walk(join(directory, item.name), path + item.name + '/');
          else if (item.isFile()) result.push(path + item.name);
          else throw recoveryFailure();
          if (result.length > 100000) throw recoveryFailure();
        }
      }
      await walk(directory, prefix);
      return result;
    },
    async remove(key) { const path = await pathFor(key); if (!(await lstat(path)).isFile()) throw recoveryFailure(); await unlink(path); await syncDirectory(dirname(path)); },
  };
}

export function s3RecoveryStore({ endpoint, region, bucket, accessKeyId, secretAccessKey, dataset }) {
  let url;
  try { url = new URL(endpoint); } catch { throw recoveryFailure(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !region || !bucket || !accessKeyId || !secretAccessKey || !/^[a-f0-9-]{36}$/.test(dataset || '')) throw recoveryFailure();
  const client = new S3Client({ endpoint: url.origin, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
  const prefix = `fullbleed-recovery/${dataset}/`;
  const send = async (command, timeout = 3000) => {
    try { return await client.send(command, { abortSignal: AbortSignal.timeout(timeout) }); }
    catch (error) { if (error?.$metadata?.httpStatusCode === 412) throw conflict(); throw recoveryFailure(); }
  };
  const objectKey = key => { if (!validKey(key)) throw recoveryFailure(); return prefix + key; };
  return {
    async read(key, maxBytes) {
      const result = await send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }), maxBytes <= 4096 ? 1400 : 30000);
      if (!result.Body || !Number.isSafeInteger(result.ContentLength) || result.ContentLength > maxBytes) { result.Body?.destroy?.(); throw recoveryFailure(); }
      let length = 0; const chunks = [];
      try {
        for await (const chunk of result.Body) {
          length += chunk.length;
          if (length > maxBytes) throw recoveryFailure();
          chunks.push(chunk);
        }
        if (length !== result.ContentLength) throw recoveryFailure();
        return Buffer.concat(chunks);
      } catch { result.Body.destroy?.(); throw recoveryFailure(); }
    },
    async write(key, body) {
      await send(new PutObjectCommand({ Bucket: bucket, Key: objectKey(key), Body: body, ContentLength: body.length, ContentType: 'application/octet-stream', IfNoneMatch: '*' }), key.startsWith('journal/') ? 1400 : 30000);
    },
    async list(path) {
      const keys = []; let continuation;
      do {
        const result = await send(new ListObjectsV2Command({ Bucket: bucket, Prefix: objectKey(path), ContinuationToken: continuation }));
        for (const object of result.Contents || []) {
          if (!object.Key?.startsWith(prefix)) throw recoveryFailure();
          keys.push(object.Key.slice(prefix.length));
        }
        if (keys.length > 100000 || (result.IsTruncated && (!result.NextContinuationToken || result.NextContinuationToken === continuation))) throw recoveryFailure();
        continuation = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuation);
      return keys;
    },
    async remove(key) { await send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) })); },
  };
}

export async function recoveryStoreFromEnvironment(env = process.env) {
  if (env.FULLBLEED_RECOVERY_DIRECTORY) {
    if (env.RAILWAY_ENVIRONMENT_ID || env.FULLBLEED_RECOVERY_ENDPOINT) throw recoveryFailure();
    return fileRecoveryStore(env.FULLBLEED_RECOVERY_DIRECTORY);
  }
  return s3RecoveryStore({ endpoint: env.FULLBLEED_RECOVERY_ENDPOINT, region: env.FULLBLEED_RECOVERY_REGION,
    bucket: env.FULLBLEED_RECOVERY_BUCKET, accessKeyId: env.FULLBLEED_RECOVERY_ACCESS_KEY_ID,
    secretAccessKey: env.FULLBLEED_RECOVERY_SECRET_ACCESS_KEY, dataset: env.FULLBLEED_RECOVERY_DATASET });
}
