# Fullbleed Commerce: production product plan

Decision, October 2, 2026: sell dependable document workflows. Manual downloads
remain a useful preview and recovery tool. The paid product must earn its place
by removing recurring work from the merchant's day.

## Merchant promise

**Your store's documents, designed once and delivered with every order.**

Start with independent retail brands and the agencies that build their stores.
They need distinctive order summaries, packing slips, care instructions and gift
inserts, without maintaining a PDF integration. Lead with the visual and HTML/CSS
editor plus native automation. Do not market an accounting or tax-compliance
system: the present engine adapter has no fiscal invoice ledger or credit notes.

## Product boundary and packaging

| Product | Included value | Initial commercial hypothesis |
| --- | --- | --- |
| WooCommerce Free | Local manual PDFs, full visual and source editor, embedded logos, import/export | Free, no account, quota, watermark or hosted dependency |
| WooCommerce Pro | Automatic attachments to selected existing transactional emails; customer downloads; status-triggered fulfillment jobs; batch export; activity and recovery; updates and support | Test $79/year for one store with a self-hosted renderer; managed rendering priced separately after cost measurements |
| Shopify Commerce | Templates, order documents, a native Flow action, expiring document links, activity/retry controls, fulfillment batches | Test $12/month for small stores and $29/month for automation-heavy stores; specify included successful renders before publishing a price |

These are hypotheses, not offers. Avoid an unlimited hosted-rendering promise.
Free customization helps adoption; charge for automation, delivery, operational
reliability and support. Code licenses do not change. The paid WordPress add-on
remains GPL-compatible and Fullbleed core remains MIT.

## First paid release

Keep the first offer specific enough to finish and support:

- **WooCommerce Pro:** branded order summaries attached to selected existing
  processing/completed emails, customer My Account downloads, saved visual and
  HTML/CSS templates, private rendering, visible failures, updates and support.
  Rendering outages preserve order mail; recovery uses an explicit merchant
  resend. Automatic recovery must not risk duplicate customer emails.
- **Shopify Commerce:** saved templates and native Flow actions returning
  expiring summary/packing-slip links, with persistent activity, bounded retries,
  pause and revocation. Validate a real order trigger and a merchant-selected
  downstream destination before advertising automatic customer delivery.

The remaining v1 gates are production hosting and monitoring, measured render
cost/capacity, installation and upgrade checks, paid lifecycle/purchase and
update delivery, privacy response/backup operations, support terms, and any
required marketplace review. Pilot the complete workflows with consenting
merchants before widening distribution.

Fulfillment-location batches, status-triggered warehouse jobs, direct email
sending, automatic missing-attachment recovery and an immutable invoice ledger
are later roadmap work. They are not prerequisites for selling the narrower
v1 promise above. Manual generation remains available for previews and recovery.

## Native workflows

| Trigger | Merchant configuration | Result | Recovery |
| --- | --- | --- | --- |
| WooCommerce sends a processing/completed email | Opt into summary attachments for specific transactional email types | PDF accompanies the email already sent by WooCommerce | Preserve the original email if rendering fails; show failure in the order/activity view and support explicit resend |
| WooCommerce customer opens My Account | Enable summary download for eligible orders | Authorized owner downloads the current order summary | Recheck ownership, order state and renderer availability on every request |
| WooCommerce payment/status transition | Choose document, status and fulfillment destination | Action Scheduler creates the warehouse document job | Unique event keys, bounded retries, visible terminal failure, manual retry |
| Shopify Flow reaches Fullbleed action | Select order and document type | Create a verified, expiring document download link, returned to following Flow steps | Signed request verification, tenant-scoped action-run deduplication, retryable status codes |
| Warehouse begins a packing run | Select orders, fulfillment location and unfulfilled items | Sorted packing-slip batch with manifest | Partial failures are explicit; printing and downloading never mark an order fulfilled |

Shopify Flow is the first native automation surface. Return a link for a
merchant-chosen downstream transactional service or internal workflow. Do not
claim arbitrary attachments in Shopify's native order-confirmation email.
Email marketing consent is not a substitute for a transactional delivery design.
Direct email delivery requires verified sender identity, a provider, bounce and
complaint handling, explicit merchant configuration and a tested delivery ledger.

WooCommerce's free renderer runs in a browser and cannot operate while everyone
is offline. Pro automation therefore needs an **optional server renderer**. It
may run on the merchant's infrastructure or a future managed service. Setup must
state what order fields leave WordPress, where they go, and what is retained.
Keep the free local workflow intact. Do not promise that every shared PHP host
can execute Node or load a native extension.

## Merchant experience

1. Pick a starter and customize it visually or paste HTML/CSS. Preview an actual
   authorized order. Save separate summary and packing-slip templates.
2. Open **Automations**. Choose a recipe, document type, trigger and destination.
   Every automation starts disabled. Show a plain-language description of the
   resulting action, not implementation details.
3. **Test with this order** creates a preview or records a dry run. It never
   emails a customer, fulfills an order or prints to a warehouse by itself.
4. Enable only after the preview and connection check pass. Show an activity list
   with order reference, template revision, event time, outcome and useful error.
5. Pause, retry a failed job or revoke a link without editing source code.
   Template changes affect future documents; do not silently rewrite issued ones.

Keep the normal path small. Advanced rules, field mapping and integration tokens
belong in a separate area. Staff can generate documents; only administrators can
change automation destinations, credentials and delivery rules.

## Document and delivery contracts

Use the existing escaped structured-order schema and print renderer. Never
evaluate merchant HTML as code, fetch arbitrary remote assets, or calculate tax.
Bundle fonts. Validate templates on the server even when the editor validated
them. Keep order, template and request-size limits consistent across entry points.

An automation job has a tenant, platform event/run ID, order ID, document kind,
template revision, state, attempt count, timestamps and a safe error code. Logs
contain these references, never names, addresses, raw order bodies, access tokens
or document URLs. Idempotency is enforced in persistent storage; a process-local
map alone is insufficient. The same event cannot issue multiple documents during
concurrent retries. A new deliberate resend gets its own delivery record.

States: pending → running → ready → delivered, with retry-wait, failed, cancelled
and expired states as appropriate. Persist the lease before work; recover expired
leases after crashes. Acknowledging a webhook means it was durably accepted,
not that a document was delivered. Keep rendering outside checkout requests.

Initial links are short-lived bearer capabilities, separate from order IDs.
Render in memory on download, require an unchanged order/template fingerprint,
and reject changed or expired documents rather than returning different content
under an old link. Store only the references and fingerprints needed to enforce
that contract. No order or PDF is kept in a shared document directory. A future
immutable archive requires explicit retention settings, private encrypted storage,
audited access, deletion and backup policies before it can be advertised.

For WordPress email attachments, use a private temporary location outside the
web root, restrictive permissions, a bounded lifetime and deletion after mail
processing. Never place customer PDFs in public uploads. For remote rendering,
use HTTPS, per-site credentials, short deadlines and no redirects. Leave the
original WooCommerce email functional when document rendering is unavailable.

## Implementation sequence and acceptance

| Milestone | Concrete scope | Release evidence required |
| --- | --- | --- |
| Editor foundation | Complete both editors and real browser downloads | Visual edit → save → reload → PDF; drag/drop; source CSS; reset; tenant and permission tests |
| Automation foundation | Stateless authenticated renderer; opt-in Woo email attachments; native Flow action returning an expiring link | Real Fullbleed PDFs through each adapter; forged/replayed events; secret and tenant isolation; renderer failures do not suppress order mail |
| Operational workflows | Persistent job worker, order/status recipes, customer portal and fulfillment batches | Duplicate/out-of-order events, process restart, queue backlog, bounded retries, revision changes, pause/resume, customer ownership and refund behavior |
| Paid staging | Hosted endpoint, subscription/license lifecycle, updates, support/privacy/refund terms | Install/upgrade/uninstall, activation/cancellation/freeze, billing failure, purchase/download/renewal, staging backups and restore |
| Public release | Approved marketplace listing and a small merchant pilot | Representative real store fixtures with consent, measured operating cost, zero unresolved critical data/delivery defects, retained review evidence |

Automation foundation alone is a development milestone, not a production-ready
release. Do not relabel the current alpha as production because its happy path
works. Production deployment and billing remain separate launch gates.

## Current implementation status

The editor foundation is complete in the development preview: both platforms
passed real Chrome editing and download checks. The first automation slice is
also implemented: an optional authenticated renderer and opt-in WooCommerce Pro
attachments through the platform's transactional-email queue, with captured-mail
verification and admin recovery guidance. It is not a managed paid service.

Shopify Flow now has order-summary and packing-slip actions backed by a persistent
job ledger, signed request verification, bounded retries, expiring private links,
and merchant pause/retry/revoke controls. The synthetic development store has
executed both actions. The ledger records preparation and download responses;
it does not claim email delivery. See [the Flow contract](../shopify/FLOW.md).

WooCommerce Pro now includes an opt-in customer portal action for current order
summaries. It checks the signed-in owner's access, processing/completed status
and refunds, reuses the saved template, streams private downloads and provides
outage recovery without staff generation. It is a live summary, not an immutable
issued invoice or a guest-access link.

Shopify customer data requests now produce encrypted snapshots of retained
metadata with a merchant export, response deadlines and explicit completion.
Access does not require a paid plan. Redaction clears the export and affected
automation references. See [the privacy workflow](../shopify/PRIVACY.md).

Persistent hosted staging now passes replacement-deployment, authentication and
real renderer checks. Eight hosted commerce PDFs match the local verified files;
runtime resource limits are enforced. Compute is stopped between attended tests
to preserve the total launch budget. See [hosted evidence](staging-verification.json).

Fulfillment batches, automatic missing-attachment recovery, privacy monitoring
and secure support-delivery setup, production operation and paid lifecycle tests
remain planned. No customer email or paid plan was enabled. Workflow testing
is confined to the synthetic development store. See [the evidence](verification.md)
for the checks actually run.

## Hard cases that must be designed before paid launch

- Split and partial fulfillments must print the items in that shipment, not the
  entire order. Cancellations and refunds invalidate outstanding fulfillment jobs.
- Edited orders, discounts, shipping, multiple currencies and tax-inclusive
  displays must preserve the platform's recorded amounts. The current adapter
  rejects edited/refunded orders; do not hide that restriction.
- Fiscal invoices require immutable numbering, issue dates, credit-note and
  jurisdiction-specific rules. Defer the claim until that ledger is implemented
  and independently reviewed.
- Default fonts do not cover every language. Detect unsupported glyphs, expose
  the limitation and add tested bundled font packs before promising global use.
- An SMTP/API acceptance is not proof of delivery. Show provider states honestly.
  Timeouts after a send require reconciliation, not blind resend.
- Orders older than Shopify's granted access window need an explicit retention
  and permission design. A saved link must not bypass a revoked installation.

## Launch and budget

Target the smallest paid release that automates a complete merchant job. Recruit
a few WooCommerce merchants and Shopify agencies using free documentation,
templates, examples and direct opt-in outreach. Demonstrate a paid order producing
the branded document automatically, then demonstrate how a failed run is recovered.
The editor is the visual hook; the completed workflow is the purchase reason.

Measure time to first working automation, successful-document rate, recurring
usage, support burden and paid conversion. Do not invent targets from absent
merchant data. Offer no lifetime hosted service and make recurring costs explicit.

The authorization is $50 total. Spending remains in
[launch-budget.json](launch-budget.json). Reserve room for Shopify registration
and a short staging-hosting trial; no charge or recurring infrastructure
commitment is implied by this document. Exceeding the cap requires approval.

## Platform evidence

Checked October 2, 2026. Official sources establish the integration surfaces;
competitor pages establish that automation is already a category expectation,
not proof that merchants will buy Fullbleed.

- [Shopify Flow action endpoints](https://shopify.dev/docs/apps/build/flow/actions/endpoints): signed requests, action-run IDs and response/retry behavior.
- [Flow action schema](https://shopify.dev/docs/apps/build/flow/actions/reference) and [returned data](https://shopify.dev/docs/apps/build/flow/configure-complex-data-types): native action configuration and workflow outputs.
- [Action Scheduler API](https://actionscheduler.org/api/): scheduled and unique WordPress jobs.
- [WooCommerce email implementation](https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email.html): attachment and send integration points.
- [Order Printer Pro](https://apps.shopify.com/order-printer-pro) and [WooCommerce document automation](https://woocommerce.com/document/pdf-invoice/): automatic delivery and customer downloads are established alternatives merchants can compare.
