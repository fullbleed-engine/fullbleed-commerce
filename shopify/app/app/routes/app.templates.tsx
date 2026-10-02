// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from 'react';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { useLoaderData, useBlocker } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import db from '../db.server';
import { brandForShop, commerceAccess, documentOptions } from '../commerce.server';
import { createTemplateStore } from '../../../templates.js';
import { starterTemplate } from '../../../../src/documents.js';
import { ordersQuery } from './app._index';
import 'grapesjs/dist/css/grapes.min.css';
import '../../../../src/template-editor.css';

type Template = { schema: string; html: string; css: string };
const store = createTemplateStore(db);
const noStore = { 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff' };

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, shop } = await commerceAccess(request);
  const brand = await brandForShop(session.shop, shop.name);
  const result = await (await admin.graphql(ordersQuery)).json();
  if (!result.data?.orders) throw new Response('Orders are unavailable. Check app permissions.', { status: 503 });
  const options = documentOptions(brand);
  const templates = Object.fromEntries(await Promise.all(['order-summary', 'packing-slip'].map(async kind => [kind, { ...await store.get(session.shop, kind), defaults: starterTemplate({ ...options, kind }) }])));
  return { templates, orders: result.data.orders.nodes as { id: string; name: string }[] };
}


export default function Templates() {
  const { templates, orders } = useLoaderData<typeof loader>();
  const host = useRef<HTMLDivElement>(null);
  const saved = useRef(templates);
  const [kind, setKind] = useState('order-summary');
  const [order, setOrder] = useState(orders[0]?.id || '');
  const selectedOrder = useRef(order);
  const activeEditor = useRef<{ destroy: () => void; hasUnsavedChanges: () => boolean } | undefined>(undefined);
  const [error, setError] = useState('');
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !!activeEditor.current?.hasUnsavedChanges() && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Discard the unsaved template edits and leave the editor?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => { selectedOrder.current = order; }, [order]);
  useEffect(() => {
    let cancelled = false;
    let instance: { destroy: () => void; hasUnsavedChanges: () => boolean } | undefined;
    const controller = new AbortController();
    async function send(input: Record<string, unknown>) {
      const response = await fetch('/app/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...input }), cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.headers.get('Content-Type')?.includes('text/plain') ? (await response.text()).slice(0, 400) : 'Reload the app to check your session and permissions.');
      const expectedType = input.intent === 'preview' ? 'application/pdf' : 'application/json';
      if (!response.headers.get('Content-Type')?.startsWith(expectedType)) throw new Error('Reload the app to check your session before saving or previewing.');
      return response;
    }
    import('../../../../src/template-editor.js').then(({ mountTemplateEditor }) => {
      if (cancelled || !host.current) return;
      const value = saved.current[kind];
      instance = mountTemplateEditor(host.current, {
        kind, initial: value.template, defaults: value.defaults, fontBase: '/fonts/',
        onSave: async (template: Template) => { const result = await (await send({ intent: 'save', template, revision: value.revision })).json(); Object.assign(value, result); },
        onReset: async () => { const result = await (await send({ intent: 'reset', revision: value.revision })).json(); Object.assign(value, result); },
        onPreview: async (template: Template) => { if (!selectedOrder.current) throw new Error('Select a preview order first.'); return (await send({ intent: 'preview', template, order: selectedOrder.current })).blob(); },
      });
      activeEditor.current = instance;
    }).catch(() => { if (!cancelled) setError('The editor could not load. Reload and try again.'); });
    return () => { cancelled = true; controller.abort(); instance?.destroy(); activeEditor.current = undefined; };
  }, [kind]);
  return <s-page heading="Template studio" inlineSize="large">
    <s-button slot="secondary-actions" href="/app">Back to documents</s-button>
    <s-section heading="Make it unmistakably yours">
      <s-paragraph>Compose visually or paste your HTML and CSS. Save a separate template for each document type. Preview with an order before saving.</s-paragraph>
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
        <s-select label="Document template" value={kind} onChange={event => { if (!activeEditor.current?.hasUnsavedChanges() || window.confirm('Discard the unsaved template edits and switch document type?')) setKind(event.currentTarget.value); else event.currentTarget.value = kind; }}><s-option value="order-summary">Order summary</s-option><s-option value="packing-slip">Packing slip</s-option></s-select>
        <s-select label="Preview order" value={order} onChange={event => setOrder(event.currentTarget.value)}>{orders.map(item => <s-option key={item.id} value={item.id}>{item.name}</s-option>)}</s-select>
      </s-grid>
      {error && <s-banner tone="critical">{error}</s-banner>}
      <div ref={host} />
    </s-section>
  </s-page>;
}

export const headers: HeadersFunction = args => { const result = new Headers(boundary.headers(args)); for (const [key, value] of Object.entries(noStore)) result.set(key, value); return result; };
