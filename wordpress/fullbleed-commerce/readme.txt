=== Fullbleed Commerce ===
Contributors: kfinkelstein
Tags: pdf, woocommerce, packing slips, order documents
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.2
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Designed order summaries and packing slips, generated in the merchant's browser with Fullbleed.

== Description ==

Create an order summary or packing slip directly from WooCommerce Orders. Choose A4 or US Letter, an accent color, and a closing note. The bundled Fullbleed WebAssembly engine creates a downloadable PDF with embedded fonts.

Customize layouts with the included visual editor or paste your own static HTML and CSS. Insert order fields and repeating item rows, upload an embedded PNG/JPEG logo, and preview a real PDF before saving. Each document type has its own template. Import/export JSON backups or reset to the built-in design. Saved templates are private store options; order data and PDFs are not saved.

No external account, quota, watermark, telemetry, or cloud renderer. The plugin serves its own JavaScript, WebAssembly and fonts from your WordPress site. Order information is read through an authenticated, permission-checked WordPress endpoint and rendered in the authorized user's browser. The plugin does not store generated PDFs.

This is a preview for evaluation on staging stores. Order summaries are not fiscal invoices. Refunded orders and automatic email attachments are not supported. Browser document limits are 250 line items, 30 pages, and 30 seconds per render. Non-Latin text can require additional fonts not exposed by this preview; a missing-glyph error prevents delivery of incomplete PDFs.

== Installation ==

1. Install and activate WooCommerce.
2. Upload the Fullbleed Commerce ZIP using Plugins > Add New > Upload Plugin.
3. Activate it, then open WooCommerce > Fullbleed documents.
4. Enter an order ID, or use Create Fullbleed PDF on an order edit screen.

== Frequently Asked Questions ==

= Does customer information leave my store? =
This plugin sends no data to Fullbleed. It reads an order from your store in the authenticated admin browser and creates the PDF there. Downloads remain on the user's device.

= Does it require Node.js on my WordPress hosting? =
No. The browser runs the bundled WebAssembly renderer. Node.js is only used to build this plugin from source.

= Can I use it with HPOS? =
The plugin uses WooCommerce order APIs, not direct post or database queries. See the release verification record for the HPOS and legacy configurations actually tested.

= Where is the source? =
The ZIP includes a source/ directory with src/admin.js, src/browser-worker.js, tools/build.mjs and package-lock.json. From that source directory, run npm ci --ignore-scripts and npm run build with Node.js 24.18 or newer. See source/README.txt for copying the rebuilt assets. Fullbleed's engine source is https://github.com/fullbleed-engine/fullbleed-official and its Node integration is https://github.com/fullbleed-engine/fullbleed-node. Build metadata and license notices ship under assets/generated/.

== Changelog ==

= 0.1.2 =
* Keep order-summary totals and the closing note together in built-in designs and new starter templates. Existing saved templates retain their own layout rules.

= 0.1.1 =
* Update the bundled renderer to Fullbleed 2.5.6. Bold text in custom templates extracts once when copied or searched in a PDF reader.

= 0.1.0 =
* WordPress directory preview: numeric plugin version and verified contributor metadata. The free document workflow and staging-preview limitations are unchanged from 0.1.0-alpha.3.

= 0.1.0-alpha.3 =
Use WordPress core libraries in the visual editor and include complete rebuildable editor source and notices.

= 0.1.0-alpha.2 =
Keep document controls disabled until the browser tools and installed add-ons are ready, so slow-loading scripts cannot submit an unhandled form or use an incomplete design.

= 0.1.0-alpha.1 =
Initial staging preview. No marketplace submission or production certification is implied.
