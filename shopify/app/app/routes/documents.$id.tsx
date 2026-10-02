// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { downloadPage } from '../../../download-page.js';
import { flowResponse } from '../../../flow.js';
import { flowService } from '../flow.server';

export const loader = ({ params }: LoaderFunctionArgs) => downloadPage(params.id);
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return flowResponse({ message: 'Use the download button.' }, 405);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return flowResponse({ message: 'This download link is not available.' }, 404);
  try { return await flowService().download(params.id, token); }
  catch (error) {
    return flowResponse({ message: 'Document preparation is temporarily busy. Please try again.' }, error instanceof Response && error.status === 429 ? 429 : 503, { 'Retry-After': '15' });
  }
}
