// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData, useNavigation, useRevalidator } from 'react-router';
import { useEffect } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import db from '../db.server';
import { commerceAccess } from '../commerce.server';
import { flowService } from '../flow.server';
import { readSettingsForm } from '../../../settings-form.js';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await commerceAccess(request);
  const [settings, jobs] = await Promise.all([
    db.automationSettings.findUnique({ where: { shop: session.shop } }),
    db.automationJob.findMany({ where: { shop: session.shop }, orderBy: { createdAt: 'desc' }, take: 50, select: {
      id: true, orderId: true, kind: true, status: true, attempts: true, downloads: true, createdAt: true, expiresAt: true, lastError: true,
    } }),
  ]);
  return { enabled: settings?.enabled || false, jobs: jobs.map(job => ({ ...job, status: job.status === 'ready' && job.expiresAt && job.expiresAt <= new Date() ? 'expired' : job.status })) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await commerceAccess(request);
  const input = await readSettingsForm(request);
  const intent = input.get('intent');
  const service = flowService();
  if (intent === 'enable' || intent === 'pause') await service.setEnabled(session.shop, intent === 'enable');
  else if (intent === 'revoke' || intent === 'retry') {
    const id = input.get('id');
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Response('Choose a document job.', { status: 400 });
    if (intent === 'revoke') await service.revoke(session.shop, id);
    else await service.retry(session.shop, id);
  } else throw new Response('Choose an automation action.', { status: 400 });
  return { saved: true };
}

const labels: Record<string, string> = { pending: 'Queued', running: 'Preparing', 'retry-wait': 'Waiting to retry', ready: 'Link ready', failed: 'Needs attention', revoked: 'Revoked', cancelled: 'Cancelled', stale: 'Order or template changed', expired: 'Expired' };
export default function Automations() {
  const { enabled, jobs } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== 'idle';
  const revalidator = useRevalidator();
  const pending = jobs.some(job => ['pending', 'running', 'retry-wait'].includes(job.status));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') revalidator.revalidate(); }, 5000);
    return () => clearInterval(timer);
  }, [pending, revalidator]);
  return <s-page heading="Document automations">
    <s-button slot="secondary-actions" href="/app/templates">Customize templates</s-button>
    <s-section heading="Design once. Deliver with your workflow.">
      <s-stack direction="block" gap="base">
        {result?.saved && <s-banner tone="success">Automation updated.</s-banner>}
        <s-paragraph>Create branded order-summary and packing-slip links from Shopify Flow. Use the link in a following step chosen by you, such as an internal notification or your transactional email service.</s-paragraph>
        <s-paragraph>Preview your templates first. Then enable automation and add a Fullbleed action to an order workflow in Shopify Flow. Links expire after 24 hours by default, and stop working if the order or template changes.</s-paragraph>
        <s-badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Automation enabled' : 'Automation paused'}</s-badge>
        <Form method="post">
          <input type="hidden" name="intent" value={enabled ? 'pause' : 'enable'} />
          <s-button type="submit" variant={enabled ? 'secondary' : 'primary'} loading={busy}>{enabled ? 'Pause and revoke active links' : 'Enable Flow automation'}</s-button>
        </Form>
        <s-paragraph color="subdued">Pausing revokes active links and stops unfinished jobs. Enabling again starts accepting new workflow runs. Fullbleed does not send customer emails or mark orders fulfilled.</s-paragraph>
      </s-stack>
    </s-section>
    <s-section heading="Recent document jobs">
      <s-stack direction="block" gap="base">
        <s-button onClick={() => revalidator.revalidate()} loading={revalidator.state !== 'idle'}>Refresh activity</s-button>
        {!jobs.length ? <s-paragraph>Your first Flow document job will appear here. Start with an order in a test workflow before enabling customer delivery.</s-paragraph> : <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Document</s-table-header><s-table-header listSlot="labeled">Status</s-table-header><s-table-header listSlot="labeled">Created</s-table-header><s-table-header listSlot="labeled">Downloads</s-table-header><s-table-header listSlot="inline">Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>{jobs.map(job => <s-table-row key={job.id}>
            <s-table-cell><s-stack direction="block" gap="small">{job.orderId ? <s-link href={`shopify://admin/orders/${job.orderId.split('/').at(-1)}`}>Order {job.orderId.split('/').at(-1)}</s-link> : <s-text>Order reference removed</s-text>}<s-text>{job.kind === 'packing-slip' ? 'Packing slip' : 'Order summary'}</s-text></s-stack></s-table-cell>
            <s-table-cell><s-stack direction="block" gap="small"><s-text>{labels[job.status] || job.status}</s-text>{job.status === 'failed' && <s-text>Check the order, template and app access before retrying.</s-text>}<s-text color="subdued">{job.attempts} preparation {job.attempts === 1 ? 'attempt' : 'attempts'}</s-text></s-stack></s-table-cell>
            <s-table-cell>{new Date(job.createdAt).toISOString().replace('T', ' ').slice(0, 16)} UTC</s-table-cell>
            <s-table-cell>{job.downloads}</s-table-cell>
            <s-table-cell>{['failed', 'retry-wait'].includes(job.status) && enabled ? <Form method="post"><input type="hidden" name="id" value={job.id} /><input type="hidden" name="intent" value="retry" /><s-button type="submit" loading={busy}>Retry preparation</s-button></Form> : ['pending', 'running', 'ready'].includes(job.status) ? <Form method="post"><input type="hidden" name="id" value={job.id} /><input type="hidden" name="intent" value="revoke" /><s-button type="submit" loading={busy}>Revoke</s-button></Form> : null}</s-table-cell>
          </s-table-row>)}</s-table-body>
        </s-table>}
        <s-paragraph color="subdued">A ready link means the PDF passed verification. A download count records completed PDF responses, not email delivery. Job history is kept for 30 days. Retrying here prepares the document; rerun a failed Flow workflow to continue its following steps.</s-paragraph>
      </s-stack>
    </s-section>
  </s-page>;
}

export const headers: HeadersFunction = args => {
  const headers = new Headers(boundary.headers(args)); headers.set('Cache-Control', 'no-store'); return headers;
};
