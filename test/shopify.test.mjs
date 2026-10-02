// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { fromShopifyOrder, fetchShopifyOrder } from '../shopify/adapter.js';
import { createPdfLoader } from '../shopify/pdf-route.js';
const price = amount => ({ presentmentMoney: { amount, currencyCode: 'USD' } });
const fixture = { id: 'gid://shopify/Order/1042', name: '#1042', createdAt: '2026-10-02T14:00:00Z', displayFinancialStatus: 'PAID', presentmentCurrencyCode: 'USD', edited: false, taxesIncluded: false,
  currentSubtotalPriceSet: price('250.00'), currentShippingPriceSet: price('12.00'), currentTotalTaxSet: price('20.96'), currentTotalPriceSet: price('282.96'), totalRefundedSet: price('0.00'),
  billingAddress: { name: 'Alex', address1: '42 Example Street' }, shippingAddress: { name: 'Alex', address1: '42 Example Street' },
  lineItems: { pageInfo: { hasNextPage: false }, nodes: [{ name: 'Linen throw', sku: 'LIN', quantity: 2, discountedTotalSet: price('250.00') }] },
};
const seller = { name: 'Cedar & Form', lines: ['18 Maker Lane'] };
test('order dates follow the merchant timezone around UTC midnight', () => {
  const order = { ...fixture, createdAt: '2026-10-02T01:00:00Z' };
  assert.equal(fromShopifyOrder(order, seller, { timeZone: 'America/Chicago' }).date, '2026-10-01');
  assert.equal(fromShopifyOrder(order, seller, { timeZone: 'UTC' }).date, '2026-10-02');
  assert.throws(() => fromShopifyOrder(order, seller, { timeZone: 'Invalid/Zone' }));
});
test('Shopify uses exact presentment values, including fractional and large amounts', () => {
  const order = structuredClone(fixture);
  order.currentTotalPriceSet = price('999999999999.123456');
  assert.equal(fromShopifyOrder(order, seller).totals.at(-1).amount, 'USD 999999999999.123456');
  order.currentTotalPriceSet = price('94.5');
  assert.equal(fromShopifyOrder(order, seller).totals.at(-1).amount, 'USD 94.50');
  const dinarOrder = JSON.parse(JSON.stringify(order).replaceAll('"USD"', '"BHD"'));
  assert.equal(fromShopifyOrder(dinarOrder, seller).totals.at(-1).amount, 'BHD 94.500');
  order.currentTotalPriceSet.presentmentMoney.currencyCode = 'CAD';
  assert.throws(() => fromShopifyOrder(order, seller), /inconsistent/);
});
test('incomplete, edited and refunded orders fail instead of producing misleading documents', () => {
  for (const mutate of [o => o.lineItems.pageInfo.hasNextPage = true, o => o.edited = true, o => o.totalRefundedSet = price('1.00')]) {
    const order = structuredClone(fixture); mutate(order);
    assert.throws(() => fromShopifyOrder(order, seller));
  }
});
test('order requests use variables and reject remote IDs or GraphQL errors', async () => {
  let called = false;
  const admin = { graphql: async (query, options) => { called = true; assert.equal(options.variables.id, fixture.id); return new Response(JSON.stringify({ errors: [{ message: 'Denied' }] })); } };
  await assert.rejects(fetchShopifyOrder(admin, 'https://attacker.invalid', seller));
  assert.equal(called, false);
  await assert.rejects(fetchShopifyOrder(admin, fixture.id, seller), /denied/);
});
test('Shopify route authenticates and checks server-side entitlement before reading any order', async () => {
  const calls = [];
  const loader = createPdfLoader({
    authenticate: { admin: async () => { calls.push('auth'); return { session: { shop: 'trusted.myshopify.com' }, admin: {} }; } },
    requireEntitlement: async shop => { calls.push(shop); throw new Response('Choose a plan.', { status: 402 }); },
    sellerForShop: async () => { throw new Error('Should not load'); },
    render: async () => { throw new Error('Should not render'); },
  });
  await assert.rejects(loader({ request: new Request('https://app.example/pdf?shop=attacker.myshopify.com&order=' + fixture.id) }), error => error.status === 402);
  assert.deepEqual(calls, ['auth', 'trusted.myshopify.com']);
});
test('authenticated and entitled Shopify route returns a real downloadable PDF', async () => {
  const loader = createPdfLoader({
    authenticate: { admin: async () => ({ session: { shop: 'trusted.myshopify.com' }, admin: { graphql: async () => new Response(JSON.stringify({ data: { order: fixture } })) } }) },
    requireEntitlement: async () => {}, sellerForShop: async () => seller,
  });
  const response = await loader({ request: new Request('https://app.example/pdf?order=' + fixture.id) });
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.match(response.headers.get('Content-Disposition'), /order-summary-1042.pdf/);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});
