# Fullbleed Commerce for Shopify

A working development app built from Shopify's official React Router template.
It is registered in the Fullbleed.dev Partner organization and installed on the
synthetic `fullbleed-commerce-test.myshopify.com` development store with
`read_orders`. It is not a hosted production service or an approved App Store
listing. No subscription is being sold or charged.

The app provides recent-order selection, order-summary and packing-slip PDFs,
Studio/Contrast/Quiet designs, seller branding, A4/Letter, accent color and a
closing note. Template studio adds visual block editing, HTML/CSS, embedded logos,
order-field insertion, save/reset/import/export and real PDF previews. Saved
templates are scoped to the authenticated shop and document type. It uses the
published Fullbleed Node package with no core changes.
See [app/README.md](app/README.md) to run it.

Native **Create order summary link** and **Create packing slip link** Flow actions
use those saved templates automatically. The app retains a persistent job ledger,
recovers expired preparation leases, retries transient failures and returns
expiring private links. Merchants can inspect activity, retry, revoke or pause.
See [Flow setup and reliability](FLOW.md) for the data and delivery contract.

## Access and data flow

`authenticate.admin(request)` from Shopify's official framework authenticates
merchant requests; `authenticate.flow(request)` verifies Flow actions. The tenant
comes from the installed session, and the shop identity is
confirmed by the Admin API. Order IDs are GraphQL variables. No URL parameter
grants an entitlement or chooses another tenant.

The app asks only for `read_orders`. Recipient names and billing/shipping
addresses additionally require Shopify's protected-customer-data settings. It
does not request customer email, phone or access to older orders. A separate
one-time CLI authorization with `write_draft_orders` created a synthetic unpaid
test order; it did not expand the app's own permissions.

Production access calls Shopify App Pricing's Partner API for current active
subscription state. Missing configuration, mismatched shop identity and upstream
failures deny access. There is no manual charge creation. The only development
exception requires all three conditions: `NODE_ENV=development`, an exact
configured test-store domain, and Shopify's `partnerDevelopment=true` response.

PDFs are generated in memory and returned with `Cache-Control: no-store`.
Orders and PDFs are not stored. SQLite stores authorization sessions and
merchant-entered brand settings and document templates, plus automation job
references, keyed fingerprints, status and download counts for up to 30 days.
Uninstall and shop-redaction webhooks delete that shop's records. Customer
redaction clears affected order references and hashes, retaining an empty run
tombstone until cleanup to prevent recreation by delayed retries. Customer
data requests capture encrypted metadata exports for authenticated merchant
download, with deadlines and explicit completion independent of paid plans.
Configure the stable privacy key and operational monitoring described in
[the privacy workflow](PRIVACY.md). The [development privacy page](app/app/routes/privacy.tsx)
describes this behavior.

The renderer permits one active request per shop and two globally per process.
Settings bodies are limited to 8 KiB while streaming. The preview rejects
cancelled, refunded, edited, truncated and inconsistent-currency orders, and uses exact
presentment amounts and the merchant's timezone. It does not calculate taxes or
produce fiscal invoices.

## Verified and outstanding

- Registered app and installed offline `read_orders` session, verified against
  the exact Shopify development store.
- One synthetic draft completed as unpaid; no payment or email action was used.
- Type generation, TypeScript, lint, production build, migrations and real
  request-handler tests pass. Tests cover forged webhooks, shop isolation,
  deletion/replay, and unauthenticated PDF requests.
- Protected-customer-data selection saved and verified through the real API.
  The installed app rendered all six variants from the tagged synthetic order,
  each one page with zero reported missing glyphs. Three resulting layouts were
  visually inspected. Real Chrome checks also passed for the visible Create PDF action, visual and
  HTML/CSS editing, template save/reload/reset, summary and packing-slip downloads. The current machine record is in [verification.json](../docs/verification.json).
- Live subscription lifecycle tests, Safari and production merchant staging remain.
  The Shopify UI toolkit validator failed in its own JSX/type environment;
  the actual application typecheck and build pass.

Public distribution has been selected; the app is not listed or approved.
Before paid release, configure a private $0 test plan, a Partner API client and
the app/plan identifiers.
Exercise plan activation, cancellation, freezes and changes; complete protected
customer data requirements and merchant staging checks; deploy with durable,
encrypted session storage; verify privacy monitoring, backup erasure and secure
support delivery; finalize support/privacy/refund terms and App Store
materials; then submit for review. No unverified data-protection answers should
be submitted as completed controls.

The proposed starting price is $12/month, subject to cost and merchant validation.
The total launch allowance is $50 and spending remains $0. The $19 App Store
registration fee may be used within that cap if required; it has not been paid.

References checked October 2, 2026:
[official template](https://github.com/Shopify/shopify-app-template-react-router),
[protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data),
[Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing),
[Partner subscription API](https://shopify.dev/docs/api/partner/latest/active-subscription),
[deployment](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service).
