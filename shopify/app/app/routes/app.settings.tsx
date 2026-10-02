// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';
import { useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import db from '../db.server';
import { brandForShop, commerceAccess, validateBrand } from '../commerce.server';
import { readSettingsForm } from '../../../settings-form.js';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, shop } = await commerceAccess(request);
  return brandForShop(session.shop, shop.name);
}
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await commerceAccess(request);
  const input = await readSettingsForm(request);
  const brand = validateBrand(input);
  await db.brand.upsert({ where: { shop: session.shop }, create: { shop: session.shop, ...brand }, update: brand });
  return { saved: true };
}
export default function Settings() {
  const brand = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [design, setDesign] = useState(brand.design);
  const [paper, setPaper] = useState(brand.paper);
  const busy = useNavigation().state !== 'idle';
  return <s-page heading="Your store, on paper">
    <s-link slot="secondary-actions" href="/app">Back to documents</s-link>
    <Form method="post">
      <s-section heading="Brand settings">
        <s-stack direction="block" gap="base">
          {result?.saved && <s-banner tone="success">Brand settings saved.</s-banner>}
          <s-text-field label="Seller name" name="sellerName" defaultValue={brand.sellerName} maxLength={120} required />
          <s-text-area label="Seller address or contact lines" name="sellerLines" defaultValue={brand.sellerLines} rows={5} maxLength={1200} details="Up to eight lines. Include only information you want printed on customer documents." />
          <s-select label="Design" name="design" value={design} onChange={event => setDesign(event.currentTarget.value)}><s-option value="studio">Studio — warm and editorial</s-option><s-option value="contrast">Contrast — bold and architectural</s-option><s-option value="quiet">Quiet — minimal and considered</s-option></s-select>
          <s-select label="Paper" name="paper" value={paper} onChange={event => setPaper(event.currentTarget.value)}><s-option value="A4">A4</s-option><s-option value="Letter">US Letter</s-option></s-select>
          <s-text-field label="Accent color" name="accent" defaultValue={brand.accent} maxLength={7} details="Six-digit hex color, for example #244a40." required />
          <s-text-area label="Closing note" name="footer" defaultValue={brand.footer} maxLength={300} rows={3} />
          <s-button type="submit" variant="primary" loading={busy} disabled={busy}>Save settings</s-button>
        </s-stack>
      </s-section>
    </Form>
  </s-page>;
}
export const headers: HeadersFunction = args => {
  const responseHeaders = new Headers(boundary.headers(args));
  responseHeaders.set('Cache-Control', 'no-store');
  return responseHeaders;
};
