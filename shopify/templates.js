// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';
import { validateTemplate } from '../src/templates.js';

export async function readTemplateRequest(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new Response('Send the template as JSON.', { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) throw new Response('A template request is required.', { status: 400 });
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 786432) { await reader.cancel(); throw new Response('Keep the template request under 768 KB.', { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Response('Check the template JSON.', { status: 400 }); }
  if (!input || !['save', 'preview', 'reset'].includes(input.intent) || !['order-summary', 'packing-slip'].includes(input.kind)) throw new Response('Choose a document type and action.', { status: 400 });
  if (input.intent !== 'preview' && (typeof input.revision !== 'string' || input.revision.length > 80)) throw new Response('Reload the template before saving.', { status: 400 });
  try { return { ...input, template: input.intent === 'reset' ? null : validateTemplate(input.template, input.kind) }; }
  catch (error) { throw new Response(error.message, { status: 422 }); }
}

export function createTemplateStore(db) {
  return {
    async get(shop, kind) {
      const saved = await db.documentTemplate.findUnique({ where: { shop_kind: { shop, kind } } });
      return { revision: saved?.revision || '', template: saved?.content ? validateTemplate(JSON.parse(saved.content), kind) : null };
    },
    async save(shop, kind, template, revision) {
      const content = template ? JSON.stringify(validateTemplate(template, kind)) : null;
      const next = randomUUID();
      const conflict = () => new Response('This template changed in another tab. Export your edits, then reload before saving.', { status: 409 });
      if (!revision) {
        try { await db.documentTemplate.create({ data: { shop, kind, content, revision: next } }); }
        catch (error) { if (error.code === 'P2002') throw conflict(); throw error; }
      } else {
        const result = await db.documentTemplate.updateMany({ where: { shop, kind, revision }, data: { content, revision: next } });
        if (result.count !== 1) throw conflict();
      }
      return { revision: next, template: content ? JSON.parse(content) : null };
    },
  };
}
