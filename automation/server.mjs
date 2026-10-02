// SPDX-License-Identifier: MIT
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createRenderer } from './renderer.js';

// Only credential hashes are needed. Keep configuration outside a public root.
const config = process.env.FULLBLEED_RENDER_CLIENTS_FILE;
if (!config) throw new Error('Set FULLBLEED_RENDER_CLIENTS_FILE to the private clients JSON file.');
const handle = createRenderer({ clients: JSON.parse(readFileSync(config, 'utf8')) });
const server = createServer(async (incoming, outgoing) => {
  const abort = new AbortController();
  incoming.on('aborted', () => abort.abort());
  outgoing.on('close', () => { if (!outgoing.writableEnded) abort.abort(); });
  try {
    const request = new Request(new URL(incoming.url, 'http://renderer.invalid'), {
      method: incoming.method, headers: incoming.headers, signal: abort.signal,
      ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }),
    });
    const response = await handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Cache-Control': 'no-store' });
    outgoing.end();
  }
});
server.requestTimeout = 35000;
server.headersTimeout = 10000;
server.maxHeadersCount = 40;
server.listen(Number(process.env.PORT || 9480), process.env.BIND_HOST || '127.0.0.1', () => console.log(JSON.stringify({ event: 'ready', port: server.address().port })));
for (const event of ['SIGTERM', 'SIGINT']) process.on(event, () => { server.close(); server.closeIdleConnections(); });
