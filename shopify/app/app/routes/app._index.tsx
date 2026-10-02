// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from 'react';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { brandForShop, commerceAccess } from '../commerce.server';

export const ordersQuery = `#graphql
query FullbleedRecentOrders {
  orders(first: 20, sortKey: CREATED_AT, reverse: true) {
    nodes { id name displayFinancialStatus }
  }
}`;

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, shop, development } = await commerceAccess(request);
  const response = await admin.graphql(ordersQuery).catch(() => {
    throw new Response('Order access is unavailable. Contact Fullbleed support to check this store’s app permissions.', { status: 503 });
  });
  const result = await response.json();
  if (!result.data?.orders) throw new Response('Orders are unavailable. Check the app permissions.', { status: 503 });
  const brand = await brandForShop(session.shop, shop.name);
  return { orders: result.data.orders.nodes as { id: string; name: string; displayFinancialStatus: string }[], design: brand.design, development };
}

export default function Documents() {
  const { orders, design, development } = useLoaderData<typeof loader>();
  const [order, setOrder] = useState(orders[0]?.id || '');
  const [kind, setKind] = useState('order-summary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  function invalidate() { controller.current?.abort(); setDownload(null); setError(''); }
  async function generate() {
    invalidate();
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 45000);
    try {
      const response = await fetch(`/app/pdf?${new URLSearchParams({ order, kind })}`, { signal: abort.signal, headers: { Accept: 'application/pdf' }, cache: 'no-store' });
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/pdf')) {
        const message = response.headers.get('Content-Type')?.includes('text/plain') ? (await response.text()).slice(0, 400) : 'The document could not be downloaded. Reload the app to check your plan and permissions.';
        throw new Error(message);
      }
      const blob = await response.blob();
      if (blob.size > 50 * 1024 * 1024 || (await blob.slice(0, 5).text()) !== '%PDF-') throw new Error('The response was not a complete PDF. Please try again.');
      const filename = response.headers.get('Content-Disposition')?.match(/filename="([a-zA-Z0-9_.-]+)"/)?.[1] || 'fullbleed-document.pdf';
      if (!abort.signal.aborted) setDownload({ url: URL.createObjectURL(blob), name: filename });
    } catch (cause) {
      if (controller.current === abort) setError(abort.signal.aborted ? 'Rendering stopped or timed out. Try again with a supported order.' : cause instanceof Error ? cause.message : 'Document generation failed.');
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) setBusy(false);
    }
  }
  return <s-page heading="Fullbleed documents">
    <s-link slot="secondary-actions" href="/app/settings">Brand settings</s-link>
    {development && <s-banner tone="info">Development-store preview. No subscription is charged in this environment.</s-banner>}
    <s-section heading="A better finish for every order">
      <s-paragraph>Create a considered order summary or a practical packing slip using your store branding.</s-paragraph>
      <s-stack direction="block" gap="base">
        <s-select label="Recent order" value={order} disabled={busy} onChange={event => { invalidate(); setOrder(event.currentTarget.value); }}>
          {orders.map(item => <s-option key={item.id} value={item.id}>{item.name} · {item.displayFinancialStatus.toLowerCase().replaceAll('_', ' ')}</s-option>)}
        </s-select>
        {!orders.length && <s-paragraph>No recent orders are available. Add a synthetic order to the development store to test documents.</s-paragraph>}
        <s-select label="Document" value={kind} disabled={busy} onChange={event => { invalidate(); setKind(event.currentTarget.value); }}>
          <s-option value="order-summary">Order summary</s-option><s-option value="packing-slip">Packing slip</s-option>
        </s-select>
        <s-paragraph>Current design: {design}. Packing slips include shipping details and quantities without prices.</s-paragraph>
        <s-button variant="primary" disabled={!order || busy} loading={busy} onClick={generate}>Create PDF</s-button>
        {error && <s-banner tone="critical">{error}</s-banner>}
        {download && <s-banner tone="success"><a href={download.url} download={download.name}>Download {download.name}</a></s-banner>}
      </s-stack>
    </s-section>
    <s-section slot="aside" heading="Designed to travel with the parcel">
      <s-paragraph>Three original designs, embedded typography, A4 or US Letter, and your closing note.</s-paragraph>
      <s-paragraph>Order summaries are not fiscal invoices. This preview does not support edited or refunded orders, more than 250 items, or unsupported characters.</s-paragraph>
      <s-paragraph>Customer data is used only to generate your download. Fullbleed does not retain the order or PDF.</s-paragraph>
      <s-link href="/privacy" target="_blank">Privacy and support</s-link>
    </s-section>
  </s-page>;
}

export const headers: HeadersFunction = args => {
  const responseHeaders = new Headers(boundary.headers(args));
  responseHeaders.set('Cache-Control', 'no-store');
  return responseHeaders;
};
