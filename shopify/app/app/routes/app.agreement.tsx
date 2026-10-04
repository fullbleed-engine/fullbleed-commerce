// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { Form, data, useActionData, useLoaderData, useNavigation } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import { agreementService } from '../agreement.server';
import { merchantAgreement, agreementHeaders } from '../../../merchant-agreement.js';
import { readSettingsForm } from '../../../settings-form.js';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return { agreement: merchantAgreement, status: await agreementService.status(session.shop) };
}

export async function action({ request }: ActionFunctionArgs) {
  const context = await authenticate.admin(request);
  try { await agreementService.accept(context, await readSettingsForm(request)); }
  catch (error) {
    if (error instanceof Response && error.status === 400) return data({ error: await error.text() }, { status: 400, headers: agreementHeaders });
    throw error;
  }
  return context.redirect('/app');
}

export default function Agreement() {
  const { agreement, status } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  return <s-page heading="Merchant agreement" inlineSize="small">
    <s-section heading="Your store’s document service">
      <s-stack direction="block" gap="base">
        <s-paragraph>Review how Fullbleed provides documents and handles your store’s data. Version {agreement.version}.</s-paragraph>
        <s-banner tone="info">Development preview: use synthetic test orders only. Production merchant admission is closed. Accepting this agreement does not purchase a plan.</s-banner>
        {status.accepted && <s-banner tone="success">Accepted for this store on {new Date(status.acceptedAt!).toISOString().replace('T', ' ').slice(0, 16)} UTC.</s-banner>}
        <s-link href={agreement.documentUrl} target="_blank">Open this version in a new tab</s-link>
        <s-link href={agreement.privacyUrl} target="_blank">Read the privacy notice</s-link>
      </s-stack>
    </s-section>
    {agreement.sections.map(section => <s-section key={section.heading} heading={section.heading}>
      <s-stack direction="block" gap="base">{section.paragraphs.map((paragraph, index) => <s-paragraph key={index}>{paragraph}</s-paragraph>)}</s-stack>
    </s-section>)}
    <s-section heading={status.accepted ? 'Agreement recorded' : 'Accept for this store'}>
      {status.accepted ? <s-link href="/app">Continue to documents</s-link> : <Form method="post">
        <input type="hidden" name="intent" value="accept" /><input type="hidden" name="version" value={agreement.version} />
        <input type="hidden" name="documentSha256" value={agreement.documentSha256} />
        <s-stack direction="block" gap="base">
          {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
          <s-checkbox name="accepted" value="yes" required label="I am authorized to act for this store and agree to the merchant agreement and data-processing terms above." />
          <s-button type="submit" variant="primary" loading={navigation.state !== 'idle'}>Accept and continue</s-button>
          <s-paragraph color="subdued">Plan selection and any payment approval happen separately in Shopify.</s-paragraph>
        </s-stack>
      </Form>}
      <s-stack direction="block" gap="base">
        <s-link href="/app/privacy">Open privacy requests</s-link>
        <s-link href="/app/access">Open access history</s-link>
      </s-stack>
    </s-section>
  </s-page>;
}

export const headers: HeadersFunction = args => {
  const headers = new Headers(boundary.headers(args));
  for (const [key, value] of Object.entries(agreementHeaders)) headers.set(key, value);
  return headers;
};
