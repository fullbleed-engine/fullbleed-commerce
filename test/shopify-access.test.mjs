import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionCheck, developmentAccess, pricingUrl } from '../shopify/billing.js';
import { createRenderLimit } from '../shopify/render-limit.js';

const identity = { shopId: 'gid://shopify/Shop/456', shop: 'cedar-test.myshopify.com' };
const active = { shop: { id: identity.shopId, myshopifyDomain: identity.shop }, items: [{ handle: 'documents', price: { active: true } }] };
const config = { organizationId: '123', appId: 'gid://shopify/App/789', accessToken: 'synthetic-test-token', allowedHandles: ['documents'] };
const reply = value => new Response(JSON.stringify({ data: { activeSubscription: value } }));

test('subscription verification uses the authenticated store and current state on every request', async () => {
  let calls = 0;
  const check = createSubscriptionCheck({ ...config, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://partners.shopify.com/123/api/2026-07/graphql.json');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body).variables, { appId: config.appId, shopId: identity.shopId });
    return reply(calls++ === 0 ? active : null);
  } });
  assert.equal(await check(identity), true);
  assert.equal(await check(identity), false);
  assert.equal(pricingUrl(identity.shop, 'fullbleed-commerce'), 'https://admin.shopify.com/store/cedar-test/charges/fullbleed-commerce/pricing_plans');
  assert.throws(() => pricingUrl('attacker.invalid', 'app'));
});

test('a current contract keeps access after a catalog price change until Shopify ends it', async () => {
  // Price.active describes the catalog price, not the merchant's subscription.
  // https://shopify.dev/docs/api/partner/2026-07/interfaces/Price
  const grandfathered = { ...active, items: [{ handle: 'documents', price: { active: false } }] };
  const scheduledCancellation = { ...grandfathered, cancelAtEndOfCycle: true };
  const states = [grandfathered, scheduledCancellation, null];
  const check = createSubscriptionCheck({ ...config, fetchImpl: async () => reply(states.shift()) });
  assert.equal(await check(identity), true);
  assert.equal(await check(identity), true);
  assert.equal(await check(identity), false);
});

test('a different shop, unavailable service and missing configuration cannot grant access', async () => {
  const mismatch = structuredClone(active); mismatch.shop.myshopifyDomain = 'another.myshopify.com';
  const check = createSubscriptionCheck({ ...config, fetchImpl: async () => reply(mismatch) });
  await assert.rejects(check(identity), error => error.status === 503);
  for (const response of [new Response('unavailable', { status: 503 }), new Response(JSON.stringify({ errors: [{ message: 'Denied' }] })), new Response('bad json')]) {
    const unavailable = createSubscriptionCheck({ ...config, fetchImpl: async () => response });
    await assert.rejects(unavailable(identity), error => error.status === 503);
  }
  const missing = createSubscriptionCheck({ ...config, accessToken: '', fetchImpl: async () => { throw new Error('Must not call'); } });
  await assert.rejects(missing(identity), error => error.status === 503);
  for (const value of [{ ...active, items: [] }, { ...active, items: [{ handle: 'unknown', price: { active: true } }] }]) {
    assert.equal(await createSubscriptionCheck({ ...config, fetchImpl: async () => reply(value) })(identity), false);
  }
});

test('development access cannot apply to production, another store, or a non-development shop', () => {
  const options = { nodeEnv: 'development', allowedStore: identity.shop, shop: identity.shop, partnerDevelopment: true };
  assert.equal(developmentAccess(options), true);
  for (const change of [{ nodeEnv: 'production' }, { nodeEnv: undefined }, { partnerDevelopment: false }, { shop: 'other.myshopify.com' }, { allowedStore: undefined }]) assert.equal(developmentAccess({ ...options, ...change }), false);
});

test('concurrent rendering is bounded and slots recover after failure', async () => {
  const limit = createRenderLimit({ maxTotal: 2 });
  let release;
  const first = limit(identity.shop, () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(limit(identity.shop, async () => 'overlap'), error => error.status === 429);
  assert.equal(await limit('other.myshopify.com', async () => 'ok'), 'ok');
  await assert.rejects(limit('other.myshopify.com', async () => { throw new Error('Render failed'); }), /Render failed/);
  assert.equal(await limit('other.myshopify.com', async () => 'recovered'), 'recovered');
  release(); await first;
  assert.equal(await limit(identity.shop, async () => 'released'), 'released');
});
