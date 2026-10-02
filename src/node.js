// SPDX-License-Identifier: MIT
import { renderPdf } from 'fullbleed';
import { buildDocument } from './documents.js';

export async function renderOrder(order, options = {}) {
  const { previewDpi = 0, signal, ...documentOptions } = options;
  const document = buildDocument(order, documentOptions);
  const result = await renderPdf({ html: document.html, css: document.css, maxPages: 30, timeoutMs: 30000, previewDpi, signal });
  return { ...result, filename: document.filename };
}
