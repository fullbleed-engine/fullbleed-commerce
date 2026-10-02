# Preview verification

Checked locally on October 2, 2026. This evidence covers the 0.1.0-alpha.1
preview, not marketplace approval or a live paid service. All order data used
was synthetic. No merchant store was changed and no customer PDF was retained.

## Executed checks

| Surface | Result | Retained evidence |
| --- | --- | --- |
| Node renderer, Shopify adapter/access/forms, browser-worker runtime, admin workflows | 32 tests passed | `output/node-tests.log` |
| WordPress/WooCommerce, free plugin with legacy storage | 46 HTTP checks passed; HPOS disabled in runtime | `output/wordpress/legacy-free-verification.json`, `legacy-free-runtime.json` |
| WordPress/WooCommerce, installed base and Pro ZIPs with HPOS | 46 HTTP checks passed; HPOS enabled in runtime | `output/wordpress/packaged-hpos-pro-verification.json`, `packaged-hpos-pro-runtime.json` |
| Six designed sample PDFs | Each one page, zero reported missing glyphs | `output/examples/verification.json` and matching PDFs/PNGs |
| Sixty-item long order summary and packing slip | Eight pages each; every SKU retained; text bounds inside pages | `output/pdf-text-verification.json`, `output/layout/` |
| Shopify application migrations, route types, TypeScript, lint, production build and request-handler tests | All checks passed; four application tests passed | `output/shopify/verification.json`, `output/shopify/webhooks.log` |
| Visual and source template editing in real Chrome 154 | Free editor saves, previews, reloads and resets; Pro also downloads a two-PDF ZIP and fits a 390px viewport | `output/browser/*-verification.json`, PDFs and screenshots |
| Custom template rendering | Summary and packing slip: one page, zero missing glyphs, deterministic output; embedded PNG verified | `output/templates/verification.json` |
| Dependency audits | Zero reported vulnerabilities in both dependency trees at check time | `output/npm-audit.json`, `output/shopify/npm-audit.json` |
| Shopify installation and test fixture | Installed offline `read_orders` session; verified development-store identity; synthetic draft completed unpaid | `output/shopify/installed-store/verification.json`, `output/shopify/test-store-after.json` |
| Live Shopify API to Fullbleed renderer | All six document/design variants rendered; one page each, zero missing glyphs | `output/shopify/installed-store/verification.json` and matching PDFs/PNGs |

The tested store ran WordPress 7.1.2, WooCommerce 11.1.2 and PHP 8.3.33.
The renderer was the published Fullbleed Node 0.1.1 package, with engine 2.5.5.
The engine, fonts and compiled JavaScript served by the installed WordPress ZIPs
matched the local packaged assets byte for byte. ZIP hashes are in
`dist/SHA256SUMS.txt`; the retained summary is [verification.json](verification.json).

ZIP timestamps use fixed local DOS fields so packaging is independent of timezone.
The packaged test stores were installed and activated through Playground. After
mobile editor refinements, frontend assets were refreshed from the final ZIPs;
unchanged PHP was checked before that refresh. All twelve final served-asset
comparisons passed. The retained record identifies the initial and final hashes.

The HTTP checks exercised logged-in administrators and shop managers, denied
anonymous users, editors and subscribers, rejected missing or invalid nonces,
preserved store display amounts, and rejected refunded orders. The Shopify route
tests verified authentication and entitlement before order reads, tenant selection
from the authenticated session, GraphQL variables, currency consistency and real
PDF output. These route tests use fixtures. The separate installed-store check
uses the real Shopify API. After protected-customer-data access was saved, all
six variants rendered from the tagged synthetic unpaid order. The Studio and
Contrast order summaries and Quiet packing slip were visually inspected.

The production React Router handler verifies signed privacy/uninstall webhooks,
rejects forged signatures, preserves another shop's records, deletes the target
shop's sessions, branding and saved templates, accepts replay, and prevents unauthenticated PDF
requests from returning documents. It also checks concurrent template saves and
merchant isolation, and renders the Documents component to catch disabled-button
regressions in Polaris custom elements. React and React DOM are pinned to 19.3.0;
Polaris script/types are pinned to the 1.1 track. These checks use an isolated synthetic SQLite
database, not the installed development app's database.

The worker tests execute the actual bundled WebAssembly engine in a Node VM with
browser APIs supplied by the test harness, and compare its PDF with Node output.
Admin tests use JSDOM and real generated PDFs to check download invalidation,
complete ZIP batches, permission failure, retry and render timeout. Neither is a
real Chrome, Safari or mobile-browser test.

All three order-summary designs were visually inspected. The long-order checks
exposed an orphan closing section on the packing slip; its layout was corrected,
rerendered and the final eighth page inspected. PDF text extraction checks support
these fixtures; they are not a general proof of non-overlap, accessibility or ISO
conformance.

## Reproduce

Use Node.js 24.18+ and Python with `requests` and `pymupdf` for the HTTP and PDF
text checks:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run examples
node tools/check-layout.mjs
python tools/check-pdf-text.py
npm run pack
npm --prefix shopify/app ci --ignore-scripts
node tools/check-shopify.mjs
node tools/wordpress.mjs --pro --hpos --packages
```

While the disposable local store is running, run `python tools/check-wordpress.py`
in a second terminal. Stop that store before starting the free legacy variant,
`node tools/wordpress.mjs`. Both use loopback port 9475 and synthetic credentials.
WordPress Playground currently downloads its latest WordPress and WooCommerce;
retain its runtime record because later runs may use different versions.

## Release work still required

- Real-browser desktop and mobile workflow checks, including downloads, worker
  execution, previews, accessibility and different hosting security policies.
  WooCommerce has passed real Chrome checks. Shopify browser testing is awaiting
  login in the available Playwright browser; the earlier regular Chrome session
  is separate. Safari and other hosting security policies remain untested.
- Representative merchant staging orders, variations, long addresses and supported
  character sets. This preview rejects missing glyphs and refunds; it does not
  implement fiscal invoices or recalculate taxes.
- Paid purchase, delivery, update and support setup for the separate Pro add-on.
  No checkout, licensing server or renewal workflow exists yet.
- Shopify live entitlement lifecycle checks, hosting and App Store review.
  The Partner organization, registered app, development store, installation and
  access to the synthetic order are verified. Billing configuration and
  production deployment are not complete.
- The Shopify toolkit's Polaris validator could not resolve its own
  `preact/jsx-runtime` and JSX types after three attempts, including a minimal
  component. The app's installed Polaris types pass TypeScript and production
  build checks; this does not substitute for real-browser QA.

The earlier [Linux CI run](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37039939445)
passed the pre-editor integration suite, clean dependency installation, plugin packaging,
Shopify application checks, Docker build, database migrations and HTTP startup
check. The retained [CI record](ci-verification.json) identifies the checked source
commit and compares the Linux archives with the Windows artifacts. No production
merchant credentials were supplied to CI.

Spending remains recorded separately in [launch-budget.json](launch-budget.json).
