// SPDX-License-Identifier: MIT
import { parseDocument } from 'htmlparser2';
import { parse as parseCss, walk as walkCss } from 'css-tree';

export const TEMPLATE_SCHEMA = 'fullbleed.commerce-template.v1';
export const TEMPLATE_LIMIT = 350000;
const encoder = new TextEncoder();
const tags = new Set('div span p h1 h2 h3 h4 h5 h6 strong em b i u s small address section article header footer main blockquote ul ol li table thead tbody tfoot tr td th colgroup col br hr img'.split(' '));
const voids = new Set(['br', 'hr', 'img', 'col']);
const attributes = new Set(['class', 'id', 'style', 'title', 'lang', 'dir', 'role', 'aria-label', 'colspan', 'rowspan', 'width', 'height', 'alt', 'src', 'data-fb-repeat']);
export const templateFields = ['order.number', 'order.date', 'order.status', 'order.currency', 'seller.name', 'seller.address', 'customer.name', 'customer.address', 'shipping.name', 'shipping.address', 'document.title', 'document.footer'];
const fields = new Set(templateFields);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fail = message => { throw new TypeError(message); };

export function validateCss(css, inline = false) {
  if (typeof css !== 'string' || encoder.encode(css).length > 65000) fail('CSS must be text under 65 KB.');
  // No escapes: this also prevents obfuscated URL functions and at-rule names.
  if (/[\\<\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(css)) fail('CSS escapes, HTML and control characters are not supported.');
  let ast;
  try { ast = parseCss(css, { context: inline ? 'declarationList' : 'stylesheet', onParseError: () => fail('Check the CSS syntax.') }); }
  catch (error) { if (error instanceof TypeError) throw error; fail('Check the CSS syntax.'); }
  let count = 0;
  walkCss(ast, node => {
    if (++count > 14000) fail('This stylesheet is too complex.');
    if (node.type === 'Url' || node.type === 'Raw') fail('CSS URLs and unrecognized CSS syntax are not supported. Upload a PNG or JPEG logo instead.');
    if (node.type === 'Atrule' && !['page', 'media'].includes(node.name.toLowerCase())) fail('Only @page and @media rules are supported. Fonts are bundled with Fullbleed.');
    if (node.type === 'Function' && ['url', 'expression', 'image', 'image-set', '-webkit-image-set'].includes(node.name.toLowerCase())) fail('External resources and executable CSS are not supported.');
    if (node.type === 'Declaration' && ['behavior', '-moz-binding'].includes(node.property.toLowerCase())) fail('Executable CSS is not supported.');
  });
  return css; // Preserve the merchant's CSS, including @page and print rules.
}

function parseTemplate(input, kind) {
  if (!input || input.schema !== TEMPLATE_SCHEMA || typeof input.html !== 'string' || typeof input.css !== 'string') fail('Choose a Fullbleed template containing HTML and CSS.');
  if (!['order-summary', 'packing-slip'].includes(kind)) fail('Choose a supported document type.');
  if (encoder.encode(input.html + input.css).length > TEMPLATE_LIMIT) fail('Keep the template, including embedded logos, under 350 KB.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(input.html)) fail('HTML contains unsupported control characters.');
  const doc = parseDocument(input.html, { decodeEntities: true });
  const styles = [];
  let count = 0;
  function visit(nodes, repeat, depth) {
    if (depth > 40) fail('HTML nesting is too deep.');
    return nodes.flatMap(node => {
      if (++count > 5000) fail('This HTML template is too complex.');
      if (node.type === 'comment' || node.type === 'directive') return [];
      if (node.type === 'text') {
        const tokens = [...node.data.matchAll(/{{\s*([^{}]+?)\s*}}/g)];
        if (node.data.replace(/{{\s*[^{}]+?\s*}}/g, '').includes('{{')) fail('Check the field syntax: {{order.number}}.');
        for (const [, token] of tokens) {
          const allowed = fields.has(token) || (repeat === 'items' && ['item.name', 'item.sku', 'item.quantity', 'item.total'].includes(token)) || (repeat === 'totals' && ['total.label', 'total.amount'].includes(token));
          if (!allowed) fail(`Unknown or misplaced field: ${token}. Item fields belong inside an items repeat block.`);
          if (kind === 'packing-slip' && (token === 'item.total' || token.startsWith('customer.'))) fail('Use shipping fields and quantities in a packing slip; billing and price fields are unavailable.');
        }
        return [{ text: node.data }];
      }
      const tag = node.name?.toLowerCase();
      if (tag === 'style') { styles.push(node.children.map(child => child.data || '').join('')); return []; }
      if (['html', 'head', 'body'].includes(tag)) {
        if (Object.keys(node.attribs).some(attr => !['lang', 'dir'].includes(attr))) fail(`Move ${tag} attributes into the document's content or CSS.`);
        return visit(node.children, repeat, depth + 1);
      }
      if (tag === 'title' || (tag === 'meta' && Object.keys(node.attribs).length === 1 && node.attribs.charset)) return [];
      if (!tags.has(tag)) fail(`The <${tag || node.type}> element is not supported in print templates.`);
      const attrs = {};
      for (const [name, value] of Object.entries(node.attribs)) {
        if (!attributes.has(name)) fail(`The ${name} attribute is not supported. Use static HTML, CSS and order fields.`);
        if (value.includes('{{')) fail('Order fields must be placed in text, not HTML attributes.');
        if (name === 'style') validateCss(value, true);
        if (name === 'src' && (tag !== 'img' || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))) fail('Images must be embedded PNG or JPEG files. Remote image URLs are not supported.');
        if (['colspan', 'rowspan'].includes(name) && !/^[1-9]\d?$/.test(value)) fail('Table spans must be between 1 and 99.');
        attrs[name] = value;
      }
      if (tag === 'img' && !attrs.src) fail('Upload a PNG or JPEG for the image.');
      const nextRepeat = attrs['data-fb-repeat'];
      if (nextRepeat && (!['items', 'totals'].includes(nextRepeat) || repeat || (kind === 'packing-slip' && nextRepeat === 'totals'))) fail('Repeat blocks support items or totals, without nesting. Packing slips use items only.');
      return [{ tag, attrs, children: visit(node.children || [], nextRepeat || repeat, depth + 1) }];
    });
  }
  const nodes = visit(doc.children, '', 0);
  const css = validateCss([...styles, input.css].filter(Boolean).join('\n'));
  return { nodes, css };
}

function serialize(nodes, values, order) {
  return nodes.map(node => {
    if (node.text !== undefined) return escape(values ? node.text.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key) => values[key] ?? '') : node.text);
    const repeat = node.attrs['data-fb-repeat'];
    if (repeat && order) {
      const rows = order[repeat];
      return rows.map(row => {
        const attrs = { ...node.attrs };
        delete attrs['data-fb-repeat'];
        if (repeat === 'totals' && row.emphasis) attrs.class = `${attrs.class || ''} grand-total`.trim();
        const prefix = repeat === 'items' ? 'item' : 'total';
        return serialize([{ ...node, attrs }], { ...values, ...Object.fromEntries(Object.entries(row).map(([key, value]) => [`${prefix}.${key}`, value])) }, order);
      }).join('');
    }
    const attrs = Object.entries(node.attrs).map(([name, value]) => ` ${name}="${escape(value)}"`).join('');
    return `<${node.tag}${attrs}>${voids.has(node.tag) ? '' : serialize(node.children, values, order) + `</${node.tag}>`}`;
  }).join('');
}

export function validateTemplate(input, kind = 'order-summary') {
  const { nodes, css } = parseTemplate(input, kind);
  const html = serialize(nodes);
  if (!html.trim()) fail('Add some document content before saving.');
  if (encoder.encode(html + css).length > TEMPLATE_LIMIT) fail('Keep the template under 350 KB.');
  return { schema: TEMPLATE_SCHEMA, html, css };
}

export function renderTemplate(input, order, { kind, footer, title }) {
  const { nodes, css } = parseTemplate(input, kind);
  const values = { 'order.number': order.number, 'order.date': order.date, 'order.status': order.status, 'order.currency': order.currency, 'document.title': title, 'document.footer': footer };
  for (const party of ['seller', 'customer', 'shipping']) {
    values[`${party}.name`] = order[party].name;
    values[`${party}.address`] = order[party].lines.join('\n');
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)} ${escape(order.number)}</title></head><body>${serialize(nodes, values, order)}</body></html>`;
  if (encoder.encode(html + css).length > 500000) fail('The expanded document is too large. Reduce template or order size.');
  return { html, css };
}
