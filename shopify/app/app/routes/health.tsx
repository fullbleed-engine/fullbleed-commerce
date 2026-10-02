import db from '../db.server';

export const loader = async () => {
  let ready = false;
  try {
    // An empty SQLite file accepts SELECT 1. Require the application tables,
    // without scanning or returning any merchant records.
    const tables = await db.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'Session', 'Brand', 'DocumentTemplate', 'AutomationSettings',
        'AutomationJob', 'PrivacyRequest', 'PrivacyRequestOrder'
      )`;
    ready = tables.length === 7;
  } catch {
    // Public readiness responses must not expose database paths or query errors.
  }
  return Response.json({ status: ready ? 'ok' : 'unavailable' }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
};
