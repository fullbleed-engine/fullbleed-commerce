// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData, useNavigation, useRevalidator } from 'react-router';
import { useEffect, useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { completePrivacyRequest, privacyHeaders } from '../../../privacy.js';
import { readSettingsForm } from '../../../settings-form.js';

export async function loader({ request }: LoaderFunctionArgs) {
  // Privacy access must never depend on a paid subscription.
  const { session } = await authenticate.admin(request);
  const cursor = new URL(request.url).searchParams.get('after');
  const where = { shop: session.shop, status: 'ready' };
  if (cursor && (!/^[0-9a-f-]{36}$/.test(cursor) || !await db.privacyRequest.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new Response('Refresh the request list.', { status: 400, headers: privacyHeaders });
  const select = { id: true, requestId: true, receivedAt: true, dueAt: true, lastExportAt: true, exports: true, status: true, finishedAt: true };
  const [rows, recent, pending, overdue] = await Promise.all([
    db.privacyRequest.findMany({ where, select, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }], take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
    db.privacyRequest.findMany({ where: { shop: session.shop, status: { in: ['completed', 'redacted'] } }, select, orderBy: { finishedAt: 'desc' }, take: 20 }),
    db.privacyRequest.count({ where }),
    db.privacyRequest.count({ where: { ...where, dueAt: { lte: new Date() } } }),
  ]);
  return { requests: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null, recent, pending, overdue };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const form = await readSettingsForm(request);
  const id = form.get('id');
  if (form.get('intent') !== 'complete' || form.get('confirmed') !== 'yes' || typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Response('Confirm that you handled the request.', { status: 400, headers: privacyHeaders });
  await completePrivacyRequest(db, session.shop, id);
  return { saved: true };
}

const date = (value: Date | string) => new Date(value).toISOString().slice(0, 10);
export default function PrivacyRequests() {
  const { requests, next, recent, pending, overdue } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  async function prepare(id: string) {
    setBusy(id); setError(''); setDownload(null);
    try {
      const response = await fetch(`/app/privacy-export?${new URLSearchParams({ id })}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('The export is unavailable. Refresh the list or contact Fullbleed support.');
      const blob = await response.blob();
      const name = response.headers.get('Content-Disposition')?.match(/filename="([a-zA-Z0-9_.-]+)"/)?.[1];
      if (!name || blob.size > 20 * 1024 * 1024 || JSON.parse(await blob.text()).format !== 'fullbleed-customer-data-v1') throw new Error('The export could not be verified. Try again.');
      setDownload({ url: URL.createObjectURL(blob), name });
      revalidator.revalidate();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Export failed.'); }
    finally { setBusy(''); }
  }
  return <s-page heading="Privacy requests">
    <s-section heading="Respond to customer data requests">
      <s-stack direction="block" gap="base">
        {result?.saved && <s-banner tone="success">Request marked handled. Its export and customer identifiers have been cleared.</s-banner>}
        {overdue > 0 && <s-banner tone="critical">{overdue} {overdue === 1 ? 'request is' : 'requests are'} past the 30-day response deadline. Handle these now or contact Fullbleed support.</s-banner>}
        <s-paragraph>Shopify sends these requests when a customer asks your store for their data. Download the retained Fullbleed metadata and use your store’s privacy process to respond. Access is available without a paid plan.</s-paragraph>
        <s-paragraph>After you have handled a request, confirm it below. Downloading an export does not send it to the customer. Treat downloaded files as private customer data.</s-paragraph>
        <s-text>{pending} awaiting response</s-text>
        <s-button onClick={() => revalidator.revalidate()} loading={revalidator.state !== 'idle'}>Refresh requests</s-button>
        {error && <s-banner tone="critical">{error}</s-banner>}
        {download && <s-banner tone="success"><a href={download.url} download={download.name}>Download {download.name}</a></s-banner>}
      </s-stack>
    </s-section>
    <s-section heading="Awaiting response">
      {!requests.length ? <s-paragraph>No outstanding customer data requests.</s-paragraph> : <s-stack direction="block" gap="base">{requests.map(row => <s-box key={row.id} padding="base" border="base" borderRadius="base">
        <s-stack direction="block" gap="base">
          <s-heading>Request {row.requestId}</s-heading>
          <s-text>Received {date(row.receivedAt)} · Respond by {date(row.dueAt)} (UTC)</s-text>
          <s-button onClick={() => prepare(row.id)} disabled={!!busy} loading={busy === row.id}>Prepare export {row.requestId}</s-button>
          {row.lastExportAt && <><s-text color="subdued">Export requested {date(row.lastExportAt)}. Customer response is still awaiting your confirmation.</s-text>
            <Form method="post" onSubmit={() => setDownload(null)}>
              <input type="hidden" name="id" value={row.id} /><input type="hidden" name="intent" value="complete" />
              <s-stack direction="block" gap="base">
                <s-checkbox name="confirmed" value="yes" required label="I have handled this request through my store’s privacy process." />
                <s-button type="submit" loading={navigation.state !== 'idle'}>Mark handled and clear export</s-button>
              </s-stack>
            </Form></>}
        </s-stack>
      </s-box>)}</s-stack>}
      {next && <s-link href={`/app/privacy?after=${next}`}>Next requests</s-link>}
      <s-link href="/app/privacy">First page</s-link>
    </s-section>
    <s-section heading="Recent receipts">
      <s-stack direction="block" gap="base">
        {!recent.length ? <s-paragraph>Handled and erased request receipts appear here for 30 days.</s-paragraph> : recent.map(row => <s-text key={row.id}>Request {row.requestId} · {row.status === 'redacted' ? 'Erased by Shopify request' : 'Marked handled by merchant'} · {row.finishedAt ? date(row.finishedAt) : ''}</s-text>)}
        <s-paragraph color="subdued">Exports contain metadata retained when the request arrived. They do not recreate previously deleted history or include order PDFs. Outstanding requests stay available until handled or erased; past-due requests need action.</s-paragraph>
        <s-link href="mailto:keenan@fullbleed.dev">Contact Fullbleed support</s-link>
      </s-stack>
    </s-section>
  </s-page>;
}

export const headers: HeadersFunction = args => {
  const headers = new Headers(boundary.headers(args));
  for (const [name, value] of Object.entries(privacyHeaders)) headers.set(name, value);
  return headers;
};
