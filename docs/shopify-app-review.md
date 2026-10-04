# Shopify local App Store review

Checked October 4, 2026 against source `fe1fc52a23b8024d89a59ed24c6b74cc4df1e103`. The
[retained record](shopify-app-review.json) includes every applicable requirement,
its code evidence, the freshly fetched requirements hash and local test results.
Shopify CLI 4.8.4 fetched the current requirements from the app project directory.

## Summary

- Likely passing: **29**
- Likely failing: **0**
- Needs review: **2**
- Groups skipped: **10**

This review covers the subset Shopify identifies as locally checkable. Shopify
will assess these and additional requirements during its official review. The
app has not been submitted, and the dashboard's final self-review confirmation
has not been checked.

## Requirements that need review

**1.1.1 — Embedded authentication with browser storage restrictions**

Why this needs attention: verify the installed embedded app in a fresh Chrome
context with third-party cookies blocked. An unauthenticated local entry-page
check does not establish that behavior.

What was detected: the app uses the official SDK, session tokens, Prisma session
storage and CDN App Bridge. Normal hosted installation and authenticated local
request-handler checks passed.

**1.2.2 — Complete billing lifecycle**

Why this needs attention: retain evidence for merchant decline, paid-cycle
renewal/cancellation and store freezes before paid launch.

What was detected: Shopify App Pricing, live contract verification and in-app
plan changes are implemented. Development-store approval, upgrade, downgrade
and reinstallation passed. Those tests did not charge a production merchant.

## Requirements that are likely failing

None found in the reviewed local code after correcting **2.3.1**. The original
scaffold asked for a shop domain on `/` and `/auth/login`; both now show an
**Open Shopify admin** link and instructions. Shopify's GET install handoff and
launch parameters are preserved. Old POST forms return to the instructions
without using their submitted shop value.

The current source passed **96 Shopify tests**, **24 plan/access browser checks**
and **13 privacy browser checks**, with actual PDF and JSON downloads. The 47
shared Commerce tests also passed after building their browser assets.
[Access-history evidence](access-audit-verification.json) retains source and
artifact hashes, test boundaries and desktop/mobile captures. The Shopify UI
toolkit validator failed in its own JSX/module environment; the actual app
typecheck, production build and Chrome checks passed.

Shopify API and embedded-admin shell boundaries in local browser checks are
synthetic. The current entry and access-history changes still need an attended
hosted rollout. Application history does not establish direct database, provider
or operator access controls, or complete the customer-data questionnaire.

## Skipped groups

- **5.1 Online store** — No theme extension.
- **5.2 Payment** — No payment extension or payment gateway scope.
- **5.3 Payment facilitator** — Opt-in review was not requested.
- **5.4 Purchase option** — No customer payment-method, own-subscription-contract or deferred-payment scopes.
- **5.5 Product sourcing** — Opt-in review was not requested.
- **5.6 Checkout customization** — No checkout UI extension targets.
- **5.7 Sales channel** — No channel_config extension.
- **5.8 Post purchase** — No checkout_post_purchase extension.
- **5.9 Mobile app builders** — Opt-in review was not requested.
- **5.10 Donation** — Donation-app review was not requested; project-maintainer funding is separate from this app.

These categories did not apply or were not requested. The app declares only two
Flow action extensions and requests `read_orders`.

The [production gates](hosted-plans.md) and
[marketplace checklist](marketplace/README.md) remain separate. No customer-data
attestations or operational policies were inferred from this code review.

## Resources

- [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [App best practices](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices)
- [App billing](https://shopify.dev/docs/apps/launch/billing)
- [Submit for review](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review)
