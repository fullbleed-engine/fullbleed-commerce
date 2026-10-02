# Fullbleed Commerce

This is an optional commerce product around the published Fullbleed Node package.
Do not change or add commerce, billing, browser, or AI dependencies to the core engine.

Keep order reads authorized and use WooCommerce CRUD APIs for both HPOS and legacy
storage. Never render customer-supplied HTML, recalculate taxes, fetch remote assets,
or retain customer documents in shared storage. Escape every order field. Do not
claim legal invoice compliance, marketplace approval, or live billing without evidence.

The free WordPress plugin must work without an account, quota, watermark, or external
request. The separate Pro add-on may be sold for its workflow, design, updates, and
support. WordPress-distributed code remains GPL-compatible; the engine remains MIT.

Run real Node and browser PDF generation, authorization tests on a local WordPress
with WooCommerce, and inspect final PDF previews before packaging. No live-store
experiments. Test with synthetic orders. Retain output hashes and diagnostics.

Launch spending authorization is $50 total, not a recurring allowance. Record actual
charges in docs/launch-budget.json. More than $50 requires explicit user approval.
