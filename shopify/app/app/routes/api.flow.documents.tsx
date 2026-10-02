// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import { verifyCommerceShop } from '../commerce.server';
import { flowService } from '../flow.server';
import { boundedFlowRequest, flowResponse, parseFlowPayload } from '../../../flow.js';

export async function action({ request }: ActionFunctionArgs) {
  try {
    const bounded = await boundedFlowRequest(request);
    const { payload, session, admin } = await authenticate.flow(bounded);
    const { shop } = await verifyCommerceShop(admin, session.shop, AbortSignal.timeout(7000));
    const input = parseFlowPayload(payload, session.shop, shop.id);
    const service = flowService();
    const job = await service.accept(input);
    const response = service.status(job);
    if (response.status === 202) service.start(job.id);
    return response;
  } catch (error) {
    if (error instanceof Response) return flowResponse({ message: error.status < 500 ? 'Check Fullbleed access, automation settings and the selected order.' : 'Fullbleed is temporarily unavailable. Flow will retry.' }, error.status, error.status === 429 ? { 'Retry-After': '15' } : {});
    return flowResponse({ message: 'Fullbleed is temporarily unavailable. Flow will retry.' }, 503);
  }
}

export const loader = () => flowResponse({ message: 'Use a Shopify Flow action.' }, 405);
