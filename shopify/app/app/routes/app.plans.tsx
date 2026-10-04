// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { Form, useLoaderData, useNavigation } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { commerceAccess, usageMeter } from '../commerce.server';
import { authenticate } from '../shopify.server';
import { pricingUrl } from '../../../billing.js';
import { plans } from '../../../usage.js';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, allowance, subscription, development } = await commerceAccess(request);
  const usage = await usageMeter.status(session.shop, allowance);
  const pending = subscription?.pendingHandles.map((handle: string) => Object.hasOwn(plans, handle) ? plans[handle as keyof typeof plans].name : null).filter(Boolean) || [];
  return { usage, name: allowance.name, startsAt: allowance.startsAt?.toISOString() || null, endsAt: allowance.endsAt.toISOString(), trial: allowance.trial, development,
    cancelAtEndOfCycle: subscription?.cancelAtEndOfCycle || false, pending,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, redirect } = await authenticate.admin(request);
  if (!process.env.SHOPIFY_APP_HANDLE) throw new Response('Plan selection is not configured. Contact support.', { status: 503 });
  return redirect(pricingUrl(session.shop, process.env.SHOPIFY_APP_HANDLE), { target: '_top' });
}

export default function PlanAndUsage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const end = new Date(data.endsAt).toISOString().replace('T', ' ').slice(0, 16);
  return <s-page heading="Plan and usage" inlineSize="small">
    {data.development && <s-banner tone="info">Development preview. No subscription is charged in this environment.</s-banner>}
    {data.cancelAtEndOfCycle && <s-banner tone="warning">Your subscription is scheduled to end on {end} UTC. Document access continues until Shopify ends the subscription.</s-banner>}
    {data.pending.length > 0 && <s-banner tone="info">Scheduled plan: {data.pending.join(', ')}. Your current allowance stays in effect until Shopify applies the change.</s-banner>}
    <s-section heading={`${data.name} · ${data.usage.limit.toLocaleString('en-US')} orders`}>
      <s-stack direction="block" gap="base">
        <s-heading>{data.usage.used.toLocaleString('en-US')} orders used</s-heading>
        <s-paragraph>{data.usage.remaining.toLocaleString('en-US')} available{data.usage.preparing ? ` · ${data.usage.preparing} being prepared` : ''}.</s-paragraph>
        <s-paragraph>{data.trial ? 'Trial allowance ends' : 'Current billing period ends'} {end} UTC.</s-paragraph>
        {!data.usage.remaining && <s-banner tone="warning">Your allowance is in use. You can still reprint orders already counted in this period. Change plans or wait for your next billing period to process new orders.</s-banner>}
        <Form method="post"><s-button type="submit" variant="primary" loading={navigation.state !== 'idle'}>Change plan in Shopify</s-button></Form>
        <s-paragraph color="subdued">Review prices and approve changes on Shopify’s pricing screen. Fullbleed does not add overage charges.</s-paragraph>
      </s-stack>
    </s-section>
    <s-section heading="One order, one allowance unit">
      <s-stack direction="block" gap="base">
        <s-paragraph>An order counts when its first document or template preview succeeds in this billing period. Its order summary, packing slip, later template previews, automation runs and downloads share that one unit.</s-paragraph>
        <s-paragraph>Failed work releases its reservation. An order processed again in a later billing period counts toward that period. Unused orders do not roll over.</s-paragraph>
        <s-paragraph>When a workflow reaches the limit, change plans or wait for renewal, then retry preparation from Automations. Rerun its Flow workflow to continue the following steps.</s-paragraph>
        <s-link href="/app/automations">Open automation activity</s-link>
      </s-stack>
    </s-section>
  </s-page>;
}

export const headers: HeadersFunction = args => {
  const headers = new Headers(boundary.headers(args)); headers.set('Cache-Control', 'no-store'); return headers;
};
