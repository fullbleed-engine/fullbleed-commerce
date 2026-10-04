// SPDX-License-Identifier: GPL-2.0-or-later
import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import { privacyService } from '../privacy.server';
import { privacyHeaders } from '../../../privacy.js';
import { staffAccess } from '../access.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const context = await authenticate.admin(request);
  const { session } = context;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Response('Choose a privacy request.', { status: 400, headers: privacyHeaders });
  return staffAccess(context, 'privacy.export', async () => {
    const report = await privacyService().exportData(session.shop, id);
    return new Response(JSON.stringify(report) + '\n', { headers: {
      ...privacyHeaders, 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="fullbleed-privacy-${report.requestId}.json"`,
    } });
  }, { requestId: id });
}
