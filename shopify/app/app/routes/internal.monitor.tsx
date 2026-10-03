import { timingSafeEqual } from 'node:crypto';
import type { LoaderFunctionArgs } from 'react-router';
import { privacyService } from '../privacy.server';

const headers = {
  'Cache-Control': 'no-store, private, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Authorization',
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = process.env.FULLBLEED_MONITOR_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [a-f0-9]{64}$/i.test(authorization) ||
      !timingSafeEqual(Buffer.from(authorization.slice(7)), Buffer.from(token))) {
    return Response.json({ status: 'unauthorized' }, {
      status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' },
    });
  }
  try {
    const { pending, overdue, dueWithin48Hours, keyMismatch } = await privacyService().status();
    const attention = dueWithin48Hours > 0 || keyMismatch > 0;
    // Operator aggregates only. Never expose shop, customer, request or order IDs,
    // export contents, URLs, credentials or underlying database errors.
    return Response.json({
      status: attention ? 'attention' : 'ok', checkedAt: new Date().toISOString(),
      privacy: { pending, overdue, dueWithin48Hours, keyMismatch },
    }, { status: attention ? 503 : 200, headers });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
};
