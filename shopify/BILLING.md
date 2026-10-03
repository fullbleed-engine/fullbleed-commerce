# Shopify subscription verification

The app uses Shopify App Pricing's hosted plan selection and the Partner API's
current `activeSubscription`. The runtime credential has **Manage apps** only.
Plan handles are server configuration, and shop identity comes from the installed
session and Admin API. A return URL's `plan_handle` never grants access.

The October 3, 2026 check used Shopify's built-in `shopify-test` plan at $0/month,
restricted to `fullbleed-commerce-test.myshopify.com`. Its development-store
subscription bypass is disabled. The actual production entitlement function ran
with `NODE_ENV=production` against the live Partner API, with these results:

| Shopify state | Access |
| --- | --- |
| No subscription | Denied |
| Free test subscription approved in Shopify admin | Allowed |
| Cancellation scheduled for the end of the cycle | Allowed |
| Test subscription approved again | Allowed |
| Immediate cancellation, followed by `activeSubscription: null` | Denied |

The [retained evidence](../docs/billing-verification.json) includes the API
responses, source hashes and verification limits. The test produced no merchant
charge. A temporary credential with the additional cancellation permission was
deleted afterward; that permission is not present on the runtime client.

Two platform details matter when implementing support operations. Requesting
immediate cancellation after a cancellation was already scheduled left the
schedule in place. After approving the free plan again, immediate cancellation
recorded `cancelledAt` and the live subscription query returned null, although
the mutation payload still contained `cancelAtEndOfCycle: true`. Re-read the
current subscription to establish access; an accepted mutation alone is not
proof that access ended. These are observed test-plan results, not a guarantee
about every plan or cancellation scenario.

An existing subscription can also reference a retired catalog price. The
`Price.active` field describes the catalog entry, not the merchant's contract.
That regression has shared and production request-handler coverage with synthetic
Shopify responses; a real catalog-price migration has not been exercised.

## Staging configuration and remaining gates

The private plan, app handle, Partner identifiers and runtime secret are saved in
Railway. The IaC definition preserves those variables. Compute remains stopped;
the configuration has not been verified through a running hosted installation.
The test subscription is cancelled at the end of this check.

Before accepting paying merchants, verify plan changes and freezes, the hosted
install-to-checkout-to-Flow workflow and privacy/backup operation. Finalize actual
paid plans, merchant limits, support/privacy/refund terms, listing media and the
protected-data review. The App Store registration is paid; the listing remains a
draft and has not been submitted or approved.

Official references checked October 3, 2026:
[Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing),
[test plans](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans),
[active subscriptions](https://shopify.dev/docs/api/partner/2026-07/active-subscription),
[cancellation](https://shopify.dev/docs/api/partner/2026-07/app-subscription-cancel),
and [catalog prices](https://shopify.dev/docs/api/partner/2026-07/interfaces/Price).
