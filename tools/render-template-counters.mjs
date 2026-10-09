// SPDX-License-Identifier: MIT
// Exercise merchant CSS through Commerce's real validation and process renderer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { version, engineVersion } from 'fullbleed';
import { starterTemplate } from '../src/documents.js';
import { renderOrder } from '../src/node.js';

const out = process.argv[2] || 'output/template-counters';
await mkdir(out, { recursive: true });
const order = JSON.parse(await readFile('fixtures/order.json', 'utf8'));
const care = JSON.parse(await readFile('fixtures/numbered-care-instructions.json', 'utf8'));
const template = starterTemplate();
template.html += '\n' + care.html;
template.css += '\n' + care.css;
const result = await renderOrder(order, { template, previewDpi: 96 });
assert.equal(result.missingGlyphs, 0);
await writeFile(join(out, 'document.pdf'), result.pdf);
for (const [i, preview] of result.previews.entries()) await writeFile(join(out, `page-${i + 1}.png`), preview);
await writeFile(join(out, 'template.json'), JSON.stringify(template, null, 2) + '\n');
const report = { checkedAt: new Date().toISOString(), node: process.version, packageVersion: version,
  engineVersion, pages: result.pages, missingGlyphs: result.missingGlyphs,
  sha256: createHash('sha256').update(result.pdf).digest('hex'),
  expectedLabels: care.expectedLabels, expectedText: care.expectedText, orderNumber: order.number };
await writeFile(join(out, 'rendered.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
