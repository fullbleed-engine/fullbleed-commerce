// SPDX-License-Identifier: MIT
// Optional server renderer. It is not imported by the free WordPress plugin.
import { createHash, timingSafeEqual } from 'node:crypto';
import { renderOrder } from '../src/node.js';
import { designs } from '../pro/designs.js';

const headers = { 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const fail = (status, code, message, extra = {}) => Response.json({ code, message }, { status, headers: { ...headers, ...extra } });
const hash = value => createHash('sha256').update(value).digest();

export function createRenderer({ clients, render = renderOrder, now = Date.now, hourlyLimit = 120, globalLimit = 2 }) {
  if (!Array.isArray(clients) || !clients.length || clients.length > 1000) throw new TypeError('Configure explicit renderer clients.');
  const accounts = new Map();
  for (const client of clients) {
    if (!/^[a-zA-Z0-9_-]{3,80}$/.test(client.site) || !/^[a-f0-9]{64}$/.test(client.tokenSha256) || accounts.has(client.site)) throw new TypeError('Use unique site IDs and SHA-256 token hashes.');
    accounts.set(client.site, { digest: Buffer.from(client.tokenSha256, 'hex'), busy: false, count: 0, reset: 0 });
  }
  let active = 0;
  return async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ ready: true }, { headers });
    if (url.pathname !== '/v1/render') return fail(404, 'not_found', 'Endpoint not found.');
    if (request.method !== 'POST') return fail(405, 'method', 'Use POST.', { Allow: 'POST' });
    const account = accounts.get(request.headers.get('X-Fullbleed-Site'));
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    // Hash both valid and invalid inputs before comparison; never log them.
    const valid = timingSafeEqual(hash(token), account?.digest || Buffer.alloc(32));
    if (!account || !valid || token.length < 32 || token.length > 512) return fail(401, 'unauthorized', 'Check the renderer connection.');
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return fail(415, 'content_type', 'Send JSON.');
    if (account.busy || active >= globalLimit) return fail(429, 'busy', 'The renderer is busy. Retry shortly.', { 'Retry-After': '10' });
    if (now() >= account.reset) { account.count = 0; account.reset = now() + 3600000; }
    if (account.count >= hourlyLimit) return fail(429, 'rate_limit', 'The hourly rendering limit has been reached.', { 'Retry-After': String(Math.max(1, Math.ceil((account.reset - now()) / 1000))) });
    account.busy = true; active++; account.count++;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
      const reader = request.body?.getReader();
      if (!reader) return fail(400, 'body', 'A document request is required.');
      const chunks = []; let size = 0;
      const abort = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 786432) { await reader.cancel(); return fail(413, 'size', 'Keep document requests under 768 KB.'); }
          chunks.push(part.value);
        }
      } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
      signal.throwIfAborted();
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return fail(400, 'json', 'Check the request JSON.'); }
      const options = input?.options;
      if (!options || !['order-summary', 'packing-slip'].includes(options.kind) || !['studio', 'contrast', 'quiet'].includes(options.design || 'studio') || Object.keys(options).some(key => !['kind', 'design', 'paper', 'accent', 'footer', 'template'].includes(key))) return fail(422, 'options', 'Choose supported document options.');
      const { design = 'studio', ...rest } = options;
      const result = await render(input.order, { ...rest, ...(design === 'studio' ? {} : { design: designs[design] }), signal });
      if (!result.pdf || result.pdf.length > 8 * 1024 * 1024 || Buffer.from(result.pdf).subarray(0, 5).toString() !== '%PDF-') return fail(422, 'pdf_size', 'The document exceeds the 8 MiB attachment limit.');
      return new Response(new Uint8Array(result.pdf), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${result.filename}"`, 'X-Fullbleed-Sha256': createHash('sha256').update(result.pdf).digest('hex') } });
    } catch (error) {
      if (error instanceof TypeError) return fail(422, 'document_invalid', 'Check the order, template and supported characters in the document preview.');
      if (request.signal.aborted || ['TimeoutError', 'AbortError'].includes(error?.name)) return fail(504, 'timeout', 'Rendering timed out. Retry or simplify the template.');
      return fail(502, 'render_failed', 'The document could not be rendered. Check the preview and retry.');
    } finally { account.busy = false; active--; }
  };
}
