// SPDX-License-Identifier: GPL-2.0-or-later
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import { accessAudit, staffAccess } from '../access.server';
import { accessHeaders, accessOperations } from '../../../access-audit.js';

export async function loader({ request }: LoaderFunctionArgs) {
  // A cancelled plan must not prevent reviewing data access.
  const context = await authenticate.admin(request);
  const after = new URL(request.url).searchParams.get('after');
  return staffAccess(context, 'access.list', ticket => accessAudit.list(context.session.shop, after, ticket.id));
}

const actions: Record<string, string> = accessOperations;
const outcomes: Record<string, string> = { started: 'Started', completed: 'Completed', denied: 'Denied', failed: 'Failed' };
const actors: Record<string, string> = { staff: 'Shopify staff', flow: 'Shopify Flow', document_link: 'Private download link', shopify_privacy: 'Shopify privacy webhook' };
const date = (value: Date | string) => new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

export default function AccessHistory() {
  const { events, next } = useLoaderData<typeof loader>();
  return <s-page heading="Access history">
    <s-section heading="Who accessed document data">
      <s-paragraph>Review staff requests, Flow preparation, private-link downloads and privacy exports for this store. History covers the last 30 days; customer deletion and uninstall remove the corresponding references sooner.</s-paragraph>
      <s-paragraph color="subdued">Staff IDs come from verified Shopify sessions. A private link identifies the document access, not the person holding it. Completed means the recorded operation finished; it does not confirm delivery or that a person read it. Started entries can include interrupted requests.</s-paragraph>
      <s-button href="/app/access">Refresh history</s-button>
    </s-section>
    <s-section heading="Recent access" padding="none">
      {!events.length ? <s-box padding="base"><s-paragraph>No earlier access is recorded for this store.</s-paragraph></s-box> : <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">Action</s-table-header>
          <s-table-header listSlot="labeled">Actor</s-table-header>
          <s-table-header listSlot="labeled">Reference</s-table-header>
          <s-table-header listSlot="labeled">Started</s-table-header>
          <s-table-header listSlot="inline">Result</s-table-header>
        </s-table-header-row>
        <s-table-body>{events.map(event => <s-table-row key={event.id}>
          <s-table-cell>{actions[event.operation] || 'Data access'}</s-table-cell>
          <s-table-cell><span style={{ overflowWrap: 'anywhere' }}>{actors[event.actorType] || 'Service'}{event.actorType === 'staff' || event.actorType === 'flow' ? ` · ${event.actorId}` : ''}</span></s-table-cell>
          <s-table-cell>{event.orderId ? <s-link href={`shopify://admin/orders/${event.orderId.split('/').at(-1)}`}>Order {event.orderId.split('/').at(-1)}</s-link> : event.requestId ? <span style={{ overflowWrap: 'anywhere' }}>Privacy request {event.requestId}</span> : <s-text color="subdued">Collection access</s-text>}</s-table-cell>
          <s-table-cell>{date(event.startedAt)}</s-table-cell>
          <s-table-cell>{outcomes[event.outcome] || 'Recorded'}</s-table-cell>
        </s-table-row>)}</s-table-body>
      </s-table>}
    </s-section>
    {next && <s-section><s-button href={`/app/access?after=${encodeURIComponent(next)}`}>Older access</s-button></s-section>}
  </s-page>;
}

export const headers: HeadersFunction = args => {
  const result = new Headers(boundary.headers(args));
  for (const [key, value] of Object.entries(accessHeaders)) result.set(key, value);
  return result;
};
