# Fullbleed Commerce

Designed order documents for online stores, powered by the unchanged MIT-licensed
Fullbleed engine. **Developer preview; paid sales and marketplace listings are not live.**

## Products

| Package | What is implemented | Distribution direction |
| --- | --- | --- |
| Fullbleed Commerce for WooCommerce | Individual order summaries and packing slips, Studio design, A4/Letter, accent color, closing note, local browser PDF generation | Free entry plugin; no account, quota, watermark, or telemetry |
| Fullbleed Commerce Pro | Contrast and Quiet designs, up to 25 selected orders exported as a ZIP, failures stop the whole batch | Separate paid download, updates, and support; proposed $49/year for one store |
| Fullbleed Commerce for Shopify | Registered development app with order selection, six document/design combinations, merchant branding, authenticated downloads, subscription checks and privacy webhooks | App subscription; proposed $9/month starting tier, subject to operating-cost and merchant validation |

Prices are hypotheses, not live offers. No checkout, subscription, purchase, or
marketplace registration is active. The engine remains available independently
under MIT; WordPress plugin code is GPL-compatible. See [LICENSE](LICENSE).

| Studio | Contrast | Quiet |
| --- | --- | --- |
| ![Studio order summary](docs/previews/studio-order-summary.png) | ![Contrast order summary](docs/previews/contrast-order-summary.png) | ![Quiet order summary](docs/previews/quiet-order-summary.png) |

These are actual Fullbleed PDF renders with synthetic order data. Generate the
PDFs locally with `npm run examples`.

## Try the WooCommerce preview

Use a staging store. Install WooCommerce, then upload
`dist/fullbleed-commerce-0.1.0-alpha.1.zip` in WordPress Plugins. Open
**WooCommerce → Fullbleed documents**, enter a numeric order ID, and generate a
PDF. An order edit screen also has a **Create Fullbleed PDF** link.

To evaluate Pro, upload the separate Pro ZIP after the base plugin. Select orders
on the Orders screen and choose **Create Fullbleed PDFs**, or enter comma-separated
IDs in the document form. Pro's workflow and design code ship separately from the
free plugin. There is no license lock in the free package.

WordPress hosting does not need Node, Python, a PDF service, or custom fonts.
JavaScript, fonts, and the WebAssembly engine are served by the merchant's own
WordPress site. Authorized staff read an order over WordPress's authenticated REST
API; rendering occurs in a dedicated worker in that browser. This plugin sends no
customer data to Fullbleed and stores no generated documents.

## Development

The development toolchain requires Node.js 24.18+ because of WordPress Playground.
The rendering integration itself uses the published Fullbleed Node 0.1.1 package,
containing engine 2.5.5, pinned to its GitHub release tarball and npm lock integrity.

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run examples
npm run pack
```

`output/examples` contains real PDFs, PNG previews, and hashes. `dist` contains
installable plugin ZIPs and SHA-256 sums. Source and build instructions accompany
the base ZIP; the add-on's complete readable JavaScript and sources accompany Pro.

Run a disposable local test store (downloads WordPress and WooCommerce):

```sh
npm run dev:wordpress -- --pro --hpos
python tools/check-wordpress.py
```

The HTTP verification script uses Python `requests`. The store binds to
`127.0.0.1:9475`. Credentials are synthetic local-test data: `admin` /
`fullbleed-local-test`. Never use that fixture script or password on a merchant
site. Omit `--pro --hpos` to test the free package with legacy order storage.

## Current verification and limits

See [docs/verification.md](docs/verification.md) for checks and gaps. Node generation,
the browser-worker runtime, DOM workflows, WordPress authentication, and actual
WooCommerce order reads are checked separately. DOM simulation is not a real
Chrome/Safari test or Shopify approval.

This preview produces order summaries, not fiscal invoices. It preserves store
display amounts and does not calculate tax, create invoice numbers, or reconcile
refunds. Refunded orders are rejected. Shopify edited orders are also rejected.
There are no automatic email attachments, automatic license updates, checkout,
multilingual font selection, or production-hosting setup yet.

Limits: 250 items/order, 30 PDF pages, 30 seconds per render, 25 orders and 50 MiB
of PDF bytes per Pro batch. Unsupported characters fail rather than silently
dropping glyphs. Validate the layouts on representative merchant orders before
production use.

## Commercial launch

The proposed paid value is merchant workflow, original document design, updates,
and support. The first launch leads with WooCommerce; Shopify reuses the same
document layer. Product care cards, gift inserts, and form-to-PDF integrations are
later options after the first merchants show demand.

The launch budget is **$50 total**, with **$0 spent**. The proposed $19 Shopify
registration fee is within that cap; no recurring hosting has been purchased.
Actual charges must be recorded in [docs/launch-budget.json](docs/launch-budget.json).
More than $50 requires explicit user approval.

Before selling: complete real-browser and staging-store checks; finalize support,
delivery/update, privacy and refund terms; connect a sales account; test purchase,
download and renewal behavior; and verify the paid product against merchant needs.
For Shopify, complete protected-data and browser tests, verify platform billing,
deploy the app, then submit it for review. The Partner connection, development
app and installation already exist. See [shopify/README.md](shopify/README.md)
for the precise status and [app development instructions](shopify/app/README.md).

## Platform and market evidence

Checked October 2, 2026; recheck before launch.

- WordPress.org permits GPL-compatible free plugins and separate externally sold
  add-ons. It prohibits trialware or locking functional code already included in
  a directory plugin. [Official plugin guidelines](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/).
- Shopify App Pricing is the default for supported new public-app billing models;
  subscription state must be verified server-side using the Partner API.
  [Official billing documentation](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing).
- Shopify lists a $19 one-time App Store registration fee per Partner account.
  [Official distribution fees](https://shopify.dev/docs/apps/launch/distribution/revenue-share).
- There are established paid competitors. At the check date, Order Printer Pro
  listed $10/month for its first paid tier, and a WooCommerce PDF invoice/builder
  product listed $49/year. This supports testing a paid workflow product; it does
  not prove demand for Fullbleed or justify a revenue forecast.
  [Shopify listing](https://apps.shopify.com/order-printer-pro),
  [WooCommerce listing](https://woocommerce.com/products/pdf-packing-slips-and-invoice-builder/).
