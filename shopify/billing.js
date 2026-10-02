// SPDX-License-Identifier: MIT
export const subscriptionQuery = `query FullbleedSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    shop { id myshopifyDomain }
    items { handle price { active } }
  }
}`;

export function pricingUrl(shop, appHandle) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !/^[a-z0-9][a-z0-9-]*$/.test(appHandle || '')) throw new TypeError('Invalid Shopify pricing destination.');
  return `https://admin.shopify.com/store/${shop.slice(0, -14)}/charges/${appHandle}/pricing_plans`;
}

/** Credentials are server configuration. All merchant identities come from authenticated Admin API data. */
export function createSubscriptionCheck({ organizationId, appId, accessToken, allowedHandles, fetchImpl = fetch }) {
  const configured = /^[1-9]\d*$/.test(organizationId || '') && /^gid:\/\/shopify\/App\/[1-9]\d*$/.test(appId || '') && typeof accessToken === 'string' && accessToken.length > 0 && Array.isArray(allowedHandles) && allowedHandles.length > 0;
  return async function check({ shopId, shop, signal }) {
    if (!configured) throw new Response('Subscription verification is not configured. Contact support.', { status: 503 });
    if (!/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(shopId || '') || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop || '')) throw new TypeError('Authenticated Shopify shop identity is required.');
    let result;
    try {
      const timeout = AbortSignal.timeout(5000);
      const response = await fetchImpl(`https://partners.shopify.com/${organizationId}/api/2026-07/graphql.json`, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({ query: subscriptionQuery, variables: { appId, shopId } }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error('Subscription service unavailable.');
      result = await response.json();
      if (result.errors?.length || !Object.hasOwn(result.data || {}, 'activeSubscription')) throw new Error('Invalid subscription response.');
    } catch {
      throw new Response('Could not verify your subscription. Please try again.', { status: 503 });
    }
    const subscription = result.data.activeSubscription;
    if (subscription === null) return false;
    if (subscription?.shop?.id !== shopId || subscription?.shop?.myshopifyDomain !== shop) throw new Response('Subscription shop identity did not match.', { status: 503 });
    return Array.isArray(subscription.items) && subscription.items.some(item => allowedHandles.includes(item.handle) && item.price?.active === true);
  };
}

export function developmentAccess({ nodeEnv, allowedStore, shop, partnerDevelopment }) {
  return nodeEnv === 'development' && typeof allowedStore === 'string' && allowedStore === shop && partnerDevelopment === true;
}
