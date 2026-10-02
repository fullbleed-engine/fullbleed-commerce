// SPDX-License-Identifier: GPL-2.0-or-later
import { authenticate } from './shopify.server';
import db from './db.server';
import { createSubscriptionCheck, developmentAccess, pricingUrl } from '../../billing.js';
import { createRenderLimit } from '../../render-limit.js';
import { designs as proDesigns } from '../../../pro/designs.js';

export const shopQuery = `#graphql
query FullbleedShop {
  shop { id name myshopifyDomain ianaTimezone plan { partnerDevelopment } }
}`;

const checkSubscription = createSubscriptionCheck({
  organizationId: process.env.SHOPIFY_PARTNER_ORG_ID,
  appId: process.env.SHOPIFY_PARTNER_APP_ID,
  accessToken: process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN,
  allowedHandles: (process.env.SHOPIFY_PLAN_HANDLES || '').split(',').map(value => value.trim()).filter(Boolean),
});

export const withRenderLimit = createRenderLimit();

export async function commerceAccess(request: Request) {
  const context = await authenticate.admin(request);
  const response = await context.admin.graphql(shopQuery);
  const result = await response.json();
  const shop = result.data?.shop;
  if (!shop || shop.myshopifyDomain !== context.session.shop) throw new Response('Could not verify the store.', { status: 503 });
  const development = developmentAccess({ nodeEnv: process.env.NODE_ENV, allowedStore: process.env.FULLBLEED_DEV_STORE, shop: context.session.shop, partnerDevelopment: shop.plan.partnerDevelopment });
  if (!development && !await checkSubscription({ shopId: shop.id, shop: context.session.shop, signal: request.signal })) {
    if (!process.env.SHOPIFY_APP_HANDLE) throw new Response('Plan selection is not configured. Contact support.', { status: 503 });
    throw context.redirect(pricingUrl(context.session.shop, process.env.SHOPIFY_APP_HANDLE), { target: '_top' });
  }
  return { ...context, shop, development };
}

export async function brandForShop(shop: string, shopName: string) {
  const saved = await db.brand.findUnique({ where: { shop } });
  return saved || { shop, sellerName: shopName, sellerLines: '', accent: '#244a40', footer: 'Thank you for shopping with us.', paper: 'A4', design: 'studio' };
}

export function validateBrand(input: FormData) {
  function value(key: string, limit: number) {
    const field = input.get(key);
    // eslint-disable-next-line no-control-regex -- Reject nonprinting control characters in merchant settings.
    if (typeof field !== 'string' || field.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(field)) throw new Response('Check the brand settings and try again.', { status: 400 });
    return field.trim();
  }
  const brand = { sellerName: value('sellerName', 120), sellerLines: value('sellerLines', 1200), accent: value('accent', 7), footer: value('footer', 300), paper: value('paper', 6), design: value('design', 16) };
  if (!brand.sellerName || !/^#[0-9a-f]{6}$/i.test(brand.accent) || !['A4', 'Letter'].includes(brand.paper) || !['studio', 'contrast', 'quiet'].includes(brand.design) || brand.sellerLines.split(/\r?\n/).length > 8 || brand.sellerLines.split(/\r?\n/).some(line => line.length > 160)) throw new Response('Use a seller name, valid color and no more than eight address lines.', { status: 400 });
  return brand;
}

export function documentOptions(brand: Awaited<ReturnType<typeof brandForShop>>) {
  return { paper: brand.paper, accent: brand.accent, footer: brand.footer, ...(brand.design === 'studio' ? {} : { design: proDesigns[brand.design as keyof typeof proDesigns] }) };
}
