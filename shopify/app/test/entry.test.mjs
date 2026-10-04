import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestHandler } from 'react-router';

if (!process.env.DATABASE_URL?.includes('webhook-test.sqlite') || process.env.SHOPIFY_API_SECRET !== 'synthetic-webhook-test-secret') throw new Error('Run only against the isolated synthetic webhook database.');
const handler = createRequestHandler(await import('../build/server/index.js'), 'production');
const origin = 'https://fullbleed-test.invalid';

test('direct visitors enter through Shopify without supplying a shop domain', async () => {
  for (const path of ['/', '/auth/login', '/auth/login?shop=untrusted.invalid']) {
    const response = await handler(new Request(origin + path));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const html = await response.text();
    assert.match(html, /Open Fullbleed in Shopify/);
    assert.match(html, /href="https:\/\/admin\.shopify\.com\/"/);
    assert.doesNotMatch(html, /<form\b|<input\b|<s-text-field\b|Shop domain/);
    assert.doesNotMatch(html, /untrusted\.invalid/);
  }
});

test('Shopify launch parameters still reach the protected app route', async () => {
  const parameters = new URLSearchParams({ shop: 'synthetic-entry.myshopify.com', host: 'synthetic-host', embedded: '1' });
  const response = await handler(new Request(`${origin}/?${parameters}`));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), `/app?${parameters}`);
});

test('SDK login handoff uses the configured app on a Shopify-owned install page', async () => {
  const response = await handler(new Request(`${origin}/auth/login?shop=synthetic-entry.myshopify.com`));
  assert.equal(response.status, 302);
  const destination = new URL(response.headers.get('Location'));
  assert.equal(destination.origin, 'https://admin.shopify.com');
  assert.equal(destination.pathname, '/store/synthetic-entry/oauth/install');
  assert.equal(destination.searchParams.get('client_id'), process.env.SHOPIFY_API_KEY);
});

test('manual shop-domain form submissions cannot initiate installation', async () => {
  const response = await handler(new Request(`${origin}/auth/login`, {
    method: 'POST', body: new URLSearchParams({ shop: 'synthetic-entry.myshopify.com' }),
  }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/auth/login');
});

test('anonymous entry cannot bypass SDK authentication for documents', async () => {
  const response = await handler(new Request(`${origin}/app/pdf?order=gid://shopify/Order/1`));
  assert.match(response.headers.get('Content-Type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /shopifycloud\/app-bridge\.js/);
  assert.doesNotMatch(html, /%PDF-|Content-Disposition|synthetic-entry/);
});
