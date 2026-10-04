// SPDX-License-Identifier: MIT
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { merchantAgreement } from '../shopify/merchant-agreement.js';

const output = resolve(process.argv[2] || `output/agreements/${merchantAgreement.version}.md`);
const paragraphs = merchantAgreement.sections.map(section => `## ${section.heading}\n\n${section.paragraphs.join('\n\n')}`).join('\n\n');
const markdown = `---\ntitle: Fullbleed Commerce merchant agreement\ndescription: Version ${merchantAgreement.version} of Fullbleed Commerce's hosted Shopify service and data-processing terms.\n---\n\n<!-- Generated from shopify/agreements/${merchantAgreement.version}.js; SHA-256 ${merchantAgreement.documentSha256}. Do not hand-edit this version. -->\n\n# ${merchantAgreement.title}\n\nVersion ${merchantAgreement.version}.\n\n[Privacy notice](${merchantAgreement.privacyUrl}) · [Contact Fullbleed](mailto:${merchantAgreement.contact})\n\n${paragraphs}\n`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, markdown);
console.log(JSON.stringify({ version: merchantAgreement.version, documentSha256: merchantAgreement.documentSha256, output }));
