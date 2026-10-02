// SPDX-License-Identifier: MIT
/** Single-process ceiling. Production must use one process or replace this with a shared limiter. */
export function createRenderLimit({ maxTotal = 2 } = {}) {
  const activeShops = new Set();
  return async (shop, task) => {
    if (activeShops.has(shop) || activeShops.size >= maxTotal) throw new Response('A document is already being prepared. Try again shortly.', { status: 429, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } });
    activeShops.add(shop);
    try { return await task(); } finally { activeShops.delete(shop); }
  };
}
