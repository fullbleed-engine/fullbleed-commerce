=== Fullbleed Commerce Pro ===
Contributors: krflol
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 0.1.0-alpha.1
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Document workflows, additional designs and batch PDF exports for Fullbleed Commerce.

== Description ==
Separate add-on intended for direct paid distribution with updates and support. This evaluation build has no checkout, licensing server, automatic updater or live billing.

Adds Contrast and Quiet document designs and ZIP export of up to 25 selected orders. Use the WooCommerce Orders bulk action or enter multiple order IDs in Fullbleed documents. Every order is individually authorized. Manual PDFs render locally in the browser; failed batches do not download a partial ZIP.

Optional automation attaches PDFs to selected existing WooCommerce transactional emails using a connected server renderer. It starts disabled. The administrator configures an HTTPS renderer, server-side credentials and explicit permission to send order document fields and templates to that renderer. Saved document templates are reused. WooCommerce background transactional emails are enabled when attachment rules are active; scheduled jobs must be running.

Generated attachments are written to private temporary files outside the web root and removed after the mail request. A rendering failure leaves the original email intact and records an error on the order for manual recovery. No extra customer emails or order-status changes are made. No hosted renderer subscription is sold in this preview. See https://github.com/fullbleed-engine/fullbleed-commerce/tree/main/automation for setup, processing details and limitations.

Customer self-service is a separate opt-in in Fullbleed automation. Signed-in buyers can download an Order summary PDF from My Account for their own processing or completed orders. Guest, cancelled and refunded orders are excluded. The connected renderer uses the current order and saved summary template. PDFs are returned privately without public uploads or an archive. A 30-second customer cooldown reduces repeated requests; a renderer outage provides a retry message and a safe merchant-visible failure status. This does not create fiscal invoices or add a guest-access email link.

The plugin is GPL-compatible. Purchasing distribution, updates and support does not restrict rights granted by the GPL. No automatic disabling on subscription expiry is implemented.

Requires the separate Fullbleed Commerce base plugin and WooCommerce. This package is not intended for submission to the free WordPress.org plugin directory.
