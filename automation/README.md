# Optional automation renderer

This is a development foundation for Fullbleed Commerce Pro. The free WordPress
plugin still renders locally and has no dependency on this service.

The renderer accepts authenticated structured order data and static templates,
generates a PDF in memory, and returns it with a SHA-256 digest and `no-store`
headers. It stores no orders or documents. It uses the same published Fullbleed
Node runtime, validation, fonts and print styles as the existing integrations.

## Configure a private instance

The [Docker deployment guide](DEPLOYMENT.md) provides a pinned renderer image,
HTTPS proxy, private credential setup, maintenance and rotation instructions.
It is intended for a store operator or agency with a Linux Docker host. The
direct Node configuration below remains available for other supervised hosts.

Install the repository's locked dependencies with Node 24.18 or later. Create a
random token of at least 32 bytes with a credential manager. Give the token to
the authorized store administrator. Keep only its SHA-256 hash in a private JSON
file outside any public web directory:

```json
[
  {
    "site": "your-store-id",
    "tokenSha256": "REPLACE_WITH_SHA256_HEX_OF_THE_TOKEN"
  }
]
```

Set `FULLBLEED_RENDER_CLIENTS_FILE` to that file's absolute path, then run
`node automation/server.mjs`. It binds to `127.0.0.1:9480` by default. A production
deployment needs a supervised process behind HTTPS, private configuration,
restricted access logs, and monitoring. `PORT` and `BIND_HOST` are explicit
deployment settings. This repository does not provision hosting or sell access.

The client uses `POST /v1/render`, `Authorization: Bearer <token>`,
`X-Fullbleed-Site: <site-id>` and `Content-Type: application/json`. The body is
`{ "order": <commerce-order.v1>, "options": { "kind": "order-summary" } }`.
Document options may include `kind`, `design`, `paper`, `accent`, `footer`, and a
saved `template`. Supported designs are Studio, Contrast and Quiet. Other
options are rejected. Customer input is always escaped by the shared renderer.

Limits: 768 KiB request, 8 MiB output, one in-flight render per site, two per
process and 120 attempts per site per hour. These in-memory capacity controls
are **not billing or a durable quota ledger** and reset on restart. Deploy one
process for the development preview. A managed paid service must add persistent
entitlements, metering, revocation, load testing and abuse controls before sale.
Requests never follow remote asset URLs. `/health` reports process readiness.

## WooCommerce attachment setup

Install the base plugin and Pro on a staging store. Open **WooCommerce → Fullbleed
automation**. Enter the HTTPS renderer origin, site ID and token. Allow order
document fields to be processed by that renderer, leaving all email types
unselected. Save and test a synthetic order PDF. Then select the existing
transactional emails that should receive summaries or packing slips.

Fullbleed uses WooCommerce's background transactional-email queue when attachments
are enabled. Scheduled jobs must work on the store. Standard admin resends may
still run synchronously. The saved template for that document kind is used.
There is no additional customer email, order-status change or public PDF upload.
On a render failure, the original email continues without the Fullbleed
attachment. The order screen shows a safe error and directs staff to check the
connection, then use WooCommerce's existing resend action. **Automatic retry of a
missing attachment is not implemented yet**; it needs a delivery ledger to avoid
unwanted duplicate emails.

Attachment files use PHP's temporary directory outside the web root and are
deleted after request processing. Hosts with a public temporary directory fail
closed. Renderer tokens remain in a non-autoloaded WordPress option, never in
the editor or HTML form. Protect database backups as you would other store
credentials. A production managed service will require credential rotation and
revocation. Third-party mail queues that read attachment paths in a later request
need separate compatibility work; do not advertise support without testing.

## WooCommerce customer downloads

After testing the renderer connection, enable **Show Order summary PDF in My
Account** in Fullbleed automation. It is independent of the email attachment
selections and starts disabled, including on upgrades. Buyers can find the action
on the Orders list and on the current WooCommerce order-details template.
Themes overriding those templates must preserve WooCommerce's account actions.

Only a signed-in account that owns the order can download it. Processing and
completed orders are eligible; guest, pending, on-hold, cancelled, failed and
fully or partially refunded orders are excluded. A nonce protects the request,
and ownership and eligibility are checked independently on every download and
again after rendering. Staff privileges do not grant access through this
customer endpoint; staff continue using Fullbleed documents.

Each request uses the current order fields and saved order-summary template.
This is a fresh summary, not an archived invoice. Nothing is added to public
uploads or WooCommerce's downloadable-product files. The verified PDF stays in
request memory and is returned as a private, non-cacheable attachment. No email
is sent and no order status, amount or fulfillment is changed.

WooCommerce's native rate limiter applies a 30-second per-customer cooldown.
It reduces repeated clicks; it is not an atomic usage/billing quota or a complete
abuse-control service. The renderer's site-wide capacity limits still apply.
Errors offer a return to the customer's account without revealing renderer
responses or credentials. Failed preparation also appears on the merchant's
order screen. Customers can retry after recovery; the previous failure indicator
clears after a successful response. Disabling the setting or disconnecting the
renderer rejects future requests, including previously copied links.

## Verification and remaining work

`node --test test/renderer.test.mjs` runs real deterministic rendering plus
authorization, malformed input, size, capacity and rate-limit checks.
`node tools/check-automation.mjs --hpos` boots disposable WooCommerce, verifies its
email attachment hook, and captures real PHPMailer MIME without sending mail.
Omit `--hpos` to exercise legacy order storage. The test substitutes the HTTPS
transport with a WordPress test filter using actual Fullbleed output for the
exact serialized order. This is not proof of production networking or delivery.

`node tools/check-customer-downloads.mjs --hpos` tests real customer logins,
My Account pages and the download endpoint, including ownership, nonce replay,
statuses, partial refunds, outage recovery and changes during rendering. Omit
`--hpos` for legacy storage. `--packages` installs and verifies every entry from
the built ZIPs. Add `--serve` to retain the synthetic loopback store, then run
`python tools/check-customer-browser.py` for actual Chrome customer downloads,
mobile layout, merchant opt-in and the packaged staff WebAssembly worker.
The HTTPS transport is substituted with a test filter using real Fullbleed PDFs;
production TLS and an independently hosted renderer are separate launch gates.

Integration references: [WooCommerce account actions](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/wc-account-functions.php),
[order-details template](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/templates/order/order-details.php),
[native rate limiter](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/class-wc-rate-limiter.php),
and [WordPress nonce security](https://developer.wordpress.org/apis/security/nonces/).

The [product plan](../docs/product-plan.md) defines the larger paid product:
Shopify Flow and customer downloads are implemented in development. Fulfillment
batches, delivery recovery, merchant staging, hosting and billing retain separate
release gates; these integrations do not satisfy them all.
