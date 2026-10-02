# Optional automation renderer

This is a development foundation for Fullbleed Commerce Pro. The free WordPress
plugin still renders locally and has no dependency on this service.

The renderer accepts authenticated structured order data and static templates,
generates a PDF in memory, and returns it with a SHA-256 digest and `no-store`
headers. It stores no orders or documents. It uses the same published Fullbleed
Node runtime, validation, fonts and print styles as the existing integrations.

## Configure a private instance

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

## Verification and remaining work

`node --test test/renderer.test.mjs` runs real deterministic rendering plus
authorization, malformed input, size, capacity and rate-limit checks.
`node tools/check-automation.mjs --hpos` boots disposable WooCommerce, verifies its
email attachment hook, and captures real PHPMailer MIME without sending mail.
Omit `--hpos` to exercise legacy order storage. The test substitutes the HTTPS
transport with a WordPress test filter using actual Fullbleed output for the
exact serialized order. This is not proof of production networking or delivery.

The [product plan](../docs/product-plan.md) defines the larger paid product:
Shopify Flow, persistent jobs, customer downloads, fulfillment batches,
delivery recovery, merchant staging, hosting and billing. Those items have
separate release gates; this renderer and attachment hook do not satisfy them all.
