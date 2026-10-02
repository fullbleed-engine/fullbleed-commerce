import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.$transaction([db.session.deleteMany({ where: { shop } }), db.brand.deleteMany({ where: { shop } })]);
  return new Response(null, { status: 204 });
};
