// SPDX-License-Identifier: MIT
import { renderTemplate, TEMPLATE_SCHEMA, validateTemplate } from './templates.js';
const LIMITS = { text: 1600, items: 250, lines: 8 };
export const kinds = ['order-summary', 'packing-slip'];

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function text(value, name, max = LIMITS.text) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new TypeError(`Invalid ${name}.`);
  }
  return value;
}

function party(value, name) {
  if (!value || !Array.isArray(value.lines) || value.lines.length > LIMITS.lines) throw new TypeError(`Invalid ${name}.`);
  return { name: text(value.name, `${name} name`, 200), lines: value.lines.map(line => text(line, `${name} address`, 200)) };
}

export function validateOrder(input) {
  if (!input || input.schema !== 'fullbleed.commerce-order.v1') throw new TypeError('Unsupported order schema.');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > LIMITS.items) throw new TypeError('An order must have 1–250 line items.');
  if (!Array.isArray(input.totals) || input.totals.length > 30) throw new TypeError('Invalid totals.');
  const result = {
    schema: input.schema,
    number: text(input.number, 'order number', 80),
    date: text(input.date, 'order date', 80),
    status: text(input.status, 'order status', 80),
    currency: text(input.currency, 'currency', 3),
    seller: party(input.seller, 'seller'),
    customer: party(input.customer, 'customer'),
    shipping: party(input.shipping, 'shipping'),
    items: input.items.map(item => ({
      name: text(item.name, 'item name', 500),
      sku: text(item.sku || '', 'SKU', 150),
      quantity: text(String(item.quantity), 'quantity', 24),
      total: text(item.total, 'line total', 100),
    })),
    totals: input.totals.map(row => ({ label: text(row.label, 'total label', 100), amount: text(row.amount, 'total', 150), emphasis: row.emphasis === true })),
  };
  if (!result.number.trim() || !/^[A-Z]{3}$/.test(result.currency)) throw new TypeError('Order number and ISO currency are required.');
  for (const item of result.items) if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(item.quantity) || Number(item.quantity) <= 0) throw new TypeError('Item quantities must be positive decimal values.');
  return result;
}

export function buildDocument(input, options = {}) {
  const order = validateOrder(input);
  const { kind = 'order-summary', paper = 'A4', accent = '#c5542d', footer = 'Thank you for shopping with us.' } = options;
  if (!kinds.includes(kind) || !['A4', 'Letter'].includes(paper)) throw new TypeError('Unsupported document option.');
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new TypeError('Accent must be a six-digit hex color.');
  text(footer, 'footer', 500);
  const pack = kind === 'packing-slip';
  const address = p => `<strong>${escapeHtml(p.name)}</strong>${p.lines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}`;
  const palette = options.design || { ink: '#203a32', paper: '#fbf8ef', muted: '#667064', line: '#d8ddd1', title: 'DM Serif Display', head: '#203a32' };
  for (const key of ['ink', 'paper', 'muted', 'line', 'head']) if (!/^#[0-9a-f]{6}$/i.test(palette[key])) throw new TypeError('Invalid design color.');
  if (!['Inter', 'Bebas Neue', 'DM Serif Display'].includes(palette.title)) throw new TypeError('Invalid design font.');
  if (palette.extraCss !== undefined) text(palette.extraCss, 'design CSS', 12000);
  const title = pack ? 'Packing slip' : 'Order summary';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} ${escapeHtml(order.number)}</title></head><body>
<div class="masthead"><div class="brand">${escapeHtml(order.seller.name)}</div><div class="tag">${pack ? '' : escapeHtml(order.currency) + ' / '}${escapeHtml(order.date)}</div></div>
<div class="hero"><div class="eyebrow">${pack ? 'ORDER CONTENTS' : 'YOUR ORDER, IN DETAIL'}</div><h1>${title}</h1><div class="order-number">${escapeHtml(order.number)} <span class="status">${escapeHtml(order.status)}</span></div></div>
<div class="addresses"><div class="address"><div class="eyebrow">${pack ? 'SEND TO' : 'PREPARED FOR'}</div>${address(pack ? order.shipping : order.customer)}</div><div class="address"><div class="eyebrow">FROM</div>${address(order.seller)}</div></div>
<table class="items"><thead><tr><th class="description">${pack ? 'Item to pack' : 'Description'}</th><th class="quantity">Qty</th><th class="amount">${pack ? 'Packed' : 'Line subtotal'}</th></tr></thead><tbody>${order.items.map(item => `<tr><td><div class="item-name">${escapeHtml(item.name)}</div>${item.sku ? `<div class="sku">SKU ${escapeHtml(item.sku)}</div>` : ''}</td><td class="quantity">${escapeHtml(item.quantity)}</td><td class="amount">${pack ? '<span class="check-box"></span>' : escapeHtml(item.total)}</td></tr>`).join('')}</tbody></table>
${pack ? `<div class="packing-note"><div class="eyebrow">PACKED WITH CARE</div><p>Check each item before sealing the parcel.</p><p>Packed by __________________ &nbsp; Date __________________</p><div class="packing-closing">${escapeHtml(footer)}<br><span class="footer-reference">${escapeHtml(order.seller.name)} / ${escapeHtml(order.number)}</span></div></div>` : `<div class="totals">${order.totals.map(row => `<div class="total-row${row.emphasis ? ' grand-total' : ''}"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.amount)}</strong></div>`).join('')}</div><div class="footer"><div class="footer-rule"></div><p>${escapeHtml(footer)}</p><div class="footer-reference">${escapeHtml(order.seller.name)} / ${escapeHtml(order.number)}</div></div>`}
</body></html>`;
  const css = `@page { size: ${paper}; margin: 15mm 16mm 16mm; }
* { box-sizing: border-box; } body { font-family: Inter; font-size: 10pt; line-height: 1.45; color: ${palette.ink}; background: ${palette.paper}; }
.masthead { display:flex; justify-content:space-between; align-items:center; padding-bottom:16pt; border-bottom:1pt solid ${palette.line}; }
.brand { font-size:15pt; font-weight:700; max-width:65%; } .tag { font-size:8pt; color:${palette.muted}; text-align:right; }
.hero { margin:23pt 0 24pt; padding-left:15pt; border-left:5pt solid ${accent}; } .eyebrow { font-size:8pt; font-weight:700; letter-spacing:1.2pt; color:${palette.muted}; margin-bottom:6pt; }
h1 { font-family:'${palette.title}'; font-size:43pt; line-height:1.06; font-weight:400; margin:0 0 9pt; } .order-number { font-size:13pt; font-weight:700; } .status { font-size:9pt; font-weight:400; color:${palette.muted}; margin-left:10pt; }
.addresses { display:flex; margin-bottom:23pt; gap:28pt; } .address { width:50%; overflow-wrap:anywhere; } .address strong { display:block; margin-bottom:3pt; }
table { width:100%; border-collapse:collapse; table-layout:fixed; } .description { width:64%; } .quantity { width:10%; text-align:center; } .amount { width:26%; text-align:right; }
th { padding:10pt 9pt; color:#fff; background:${palette.head}; font-size:8pt; font-weight:700; text-align:left; } td { padding:11pt 9pt; border-bottom:0.7pt solid ${palette.line}; vertical-align:top; overflow-wrap:anywhere; } tr { break-inside:avoid; }
.item-name { font-weight:600; } .sku { font-size:8pt; color:${palette.muted}; margin-top:3pt; } .check-box { display:inline-block; width:12pt; height:12pt; border:1pt solid ${palette.muted}; }
.totals { margin:18pt 0 0 46%; break-inside:avoid; } .total-row { display:flex; justify-content:space-between; gap:10pt; padding:5pt 0; font-size:9pt; } .total-row strong { text-align:right; } .grand-total { border-top:1.5pt solid ${palette.ink}; margin-top:6pt; padding-top:10pt; font-size:14pt; }
.packing-note { margin-top:16pt; padding:12pt; background:#e9ede4; break-inside:avoid; } .packing-note p { margin:3pt 0 6pt; } .packing-closing { margin-top:7pt; padding-top:7pt; border-top:0.7pt solid ${palette.line}; font-size:9pt; }
.footer { margin-top:28pt; break-inside:avoid; } .footer-rule { width:34pt; height:4pt; background:${accent}; margin-bottom:12pt; } .footer p { margin:0 0 5pt; font-size:10pt; } .footer-reference { font-size:8pt; color:${palette.muted}; }
${palette.extraCss || ''}`;
  const slug = order.number.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'order';
  const content = options.template ? renderTemplate(options.template, order, { kind, footer, title }) : { html, css };
  return { ...content, filename: `${kind}-${slug}.pdf`, title, orderNumber: order.number };
}

// Templates contain fields, never a copy of an actual customer's order.
export function starterTemplate(options = {}) {
  const kind = options.kind || 'order-summary';
  const pack = kind === 'packing-slip';
  const marker = { schema: 'fullbleed.commerce-order.v1', number: 'Example', date: '', status: '', currency: 'USD', seller: { name: '', lines: [] }, customer: { name: '', lines: [] }, shipping: { name: '', lines: [] }, items: [{ name: '', sku: '', quantity: '1', total: '' }], totals: [] };
  const { css } = buildDocument(marker, { ...options, template: undefined });
  const recipient = pack ? 'shipping' : 'customer';
  const html = `<div class="masthead"><div class="brand">{{seller.name}}</div><div class="tag">${pack ? '' : '{{order.currency}} / '}{{order.date}}</div></div>
<div class="hero"><div class="eyebrow">${pack ? 'ORDER CONTENTS' : 'YOUR ORDER, IN DETAIL'}</div><h1>{{document.title}}</h1><div class="order-number">{{order.number}} <span class="status">{{order.status}}</span></div></div>
<div class="addresses"><div class="address"><div class="eyebrow">${pack ? 'SEND TO' : 'PREPARED FOR'}</div><strong>{{${recipient}.name}}</strong><div class="address-lines">{{${recipient}.address}}</div></div><div class="address"><div class="eyebrow">FROM</div><strong>{{seller.name}}</strong><div class="address-lines">{{seller.address}}</div></div></div>
<table class="items"><thead><tr><th class="description">${pack ? 'Item to pack' : 'Description'}</th><th class="quantity">Qty</th><th class="amount">${pack ? 'Packed' : 'Line subtotal'}</th></tr></thead><tbody><tr data-fb-repeat="items"><td><div class="item-name">{{item.name}}</div><div class="sku">{{item.sku}}</div></td><td class="quantity">{{item.quantity}}</td><td class="amount">${pack ? '<span class="check-box"></span>' : '{{item.total}}'}</td></tr></tbody></table>
${pack ? '<div class="packing-note"><div class="eyebrow">PACKED WITH CARE</div><p>Check each item before sealing the parcel.</p><p>Packed by __________________ &nbsp; Date __________________</p><div class="packing-closing">{{document.footer}}<br><span class="footer-reference">{{seller.name}} / {{order.number}}</span></div></div>' : '<div class="totals"><div class="total-row" data-fb-repeat="totals"><span>{{total.label}}</span><strong>{{total.amount}}</strong></div></div><div class="footer"><div class="footer-rule"></div><p>{{document.footer}}</p><div class="footer-reference">{{seller.name}} / {{order.number}}</div></div>'}`;
  return validateTemplate({ schema: TEMPLATE_SCHEMA, html, css: css + '\n.address-lines { white-space: pre-line; }' }, kind);
}
