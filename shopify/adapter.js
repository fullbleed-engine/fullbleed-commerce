// SPDX-License-Identifier: MIT
import { validateOrder } from '../src/documents.js';

export const orderQuery = `#graphql
query FullbleedOrder($id: ID!) {
  order(id: $id) {
    id name createdAt cancelledAt displayFinancialStatus presentmentCurrencyCode edited taxesIncluded
    billingAddress { name company address1 address2 city province zip country }
    shippingAddress { name company address1 address2 city province zip country }
    currentSubtotalPriceSet { presentmentMoney { amount currencyCode } }
    currentShippingPriceSet { presentmentMoney { amount currencyCode } }
    currentTotalTaxSet { presentmentMoney { amount currencyCode } }
    currentTotalDutiesSet { presentmentMoney { amount currencyCode } }
    currentTotalAdditionalFeesSet { presentmentMoney { amount currencyCode } }
    currentTotalPriceSet { presentmentMoney { amount currencyCode } }
    totalRefundedSet { presentmentMoney { amount currencyCode } }
    lineItems(first: 250) {
      pageInfo { hasNextPage }
      nodes { name sku quantity discountedTotalSet { presentmentMoney { amount currencyCode } } }
    }
  }
}`;

function money(bag, currency) {
  const value = bag?.presentmentMoney;
  if (!value || !/^[A-Z]{3}$/.test(currency) || value.currencyCode !== currency || typeof value.amount !== 'string' || !/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value.amount)) throw new TypeError('Missing or inconsistent Shopify presentment money.');
  // Preserve decimal strings. Never convert merchant amounts through floating point.
  // Shopify can return USD "94.5"; pad display digits without rounding its value.
  const minimumDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().minimumFractionDigits;
  const [whole, fraction = ''] = value.amount.split('.');
  const digits = fraction.padEnd(minimumDigits, '0');
  return `${currency} ${whole}${digits ? `.${digits}` : ''}`;
}

function address(value, fallback) {
  if (!value) return { name: fallback, lines: [] };
  return { name: value.name || '', lines: [value.company, value.address1, value.address2, [value.city, value.province, value.zip].filter(Boolean).join(', '), value.country].filter(Boolean) };
}

export function fromShopifyOrder(order, seller, { timeZone = 'UTC' } = {}) {
  if (!order) throw new TypeError('Order not found.');
  if (order.cancelledAt) throw new TypeError('Cancelled orders are not supported.');
  if (order.lineItems?.pageInfo?.hasNextPage !== false) throw new TypeError('Fetch a complete order before rendering; this preview supports at most 250 items.');
  if (order.edited !== false) throw new TypeError('Edited orders are not supported in this preview.');
  if (!/^0(?:\.0+)?$/.test(order.totalRefundedSet?.presentmentMoney?.amount || '')) throw new TypeError('Refunded orders require a credit-note workflow.');
  const currency = order.presentmentCurrencyCode;
  const date = new Date(order.createdAt);
  if (Number.isNaN(date.valueOf())) throw new TypeError('Invalid order date.');
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  const totals = [
    { label: 'Subtotal after discounts', amount: money(order.currentSubtotalPriceSet, currency) },
    { label: 'Shipping', amount: money(order.currentShippingPriceSet, currency) },
    { label: order.taxesIncluded ? 'Tax included' : 'Tax', amount: money(order.currentTotalTaxSet, currency) },
  ];
  for (const [label, value] of [['Duties', order.currentTotalDutiesSet], ['Additional fees', order.currentTotalAdditionalFeesSet]]) {
    if (value) totals.push({ label, amount: money(value, currency) });
  }
  totals.push({ label: 'Total', amount: money(order.currentTotalPriceSet, currency), emphasis: true });
  return validateOrder({
    schema: 'fullbleed.commerce-order.v1', number: order.name, date: `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
    status: order.displayFinancialStatus || 'Unknown', currency, seller,
    customer: address(order.billingAddress, 'Billing address not supplied'),
    shipping: address(order.shippingAddress, 'No shipping address'),
    items: order.lineItems.nodes.map(item => ({ name: item.name, sku: item.sku || '', quantity: String(item.quantity), total: money(item.discountedTotalSet, currency) })), totals,
  });
}

export async function fetchShopifyOrder(admin, id, seller, options = {}) {
  if (!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(id)) throw new TypeError('A Shopify order GID is required.');
  const response = await admin.graphql(orderQuery, { variables: { id }, ...(options.signal ? { signal: options.signal } : {}) });
  if (!response.ok) throw new Error('Shopify could not return the order.');
  const result = await response.json();
  if (result.errors?.length) throw new Error('Shopify denied or could not complete the order query. Check the app scopes and protected customer data access.');
  return fromShopifyOrder(result.data?.order, seller, options);
}
