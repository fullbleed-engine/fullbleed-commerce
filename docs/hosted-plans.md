# Hosted Shopify plans and order accounting

The October 4, 2026 check exercised Studio approval, upgrade to Scale and
downgrade to Studio on the installed synthetic development store. Shopify made
these plans free to test. Their configured merchant prices are USD 12 and USD
29 per 30 days, with seven-day trials; this check did not make a real merchant
payment. The app remains an unsubmitted App Store draft.

The [retained record](hosted-plans-verification.json) identifies the source,
deployed image, live Partner API responses, SQLite receipt, browser downloads,
uninstall delivery and cost readback. The production runtime used `read_orders`
and live subscription verification, with no development billing bypass.

| Observed operation | Result |
| --- | --- |
| Approve Studio and prepare order #1004 | One order used; 249 available |
| Approve Scale | Same order receipt; one used and 999 available |
| Approve Studio again | Same receipt; one used and 249 available |
| Reprint summary and packing slip | Same single unit; summary bytes unchanged |
| Replace the running deployment | Receipt and count preserved |
| Manually replay the existing Order created Flow on #1004 | Seven actions completed; both PDFs prepared on their first attempts |
| Download the two private Flow links in Chrome | Both hashes match the prepared PDFs and manual downloads; one order still used |
| Pause app automation | Both links return 410 |
| Uninstall through Shopify admin | Actual webhook returns 204; all nine shop-data tables empty; both links return 404 |

The workflow uses two Fullbleed actions, four native private order-metafield
writes and a diagnostic log. It sends no email and performs no fulfillment or
payment action. The synthetic order remained unpaid and unfulfilled. The
earlier [hosted workflow check](hosted-workflow.md) covers a newly created order
trigger and saved custom template; this check replays the existing order to
verify shared accounting across plans, manual generation and automation.

## Regressions found and fixed

Shopify changed the trial end on each plan approval. An allowance keyed only by
that exact timestamp displayed a fresh trial allowance after an upgrade. The
fix preserves the ongoing trial's original receipt set and extends its verified
end. Actual upgrade and downgrade checks retained one receipt and one used unit.
Paid periods continue to follow Shopify's current billing-cycle start.

CI also caught a Flow job reporting ready just before its accounting commit.
Preparation now keeps the job unavailable until accounting succeeds. Regression
checks hold that commit open, reject it and pause the job during it; no ready
link escapes those pending or failed states. The final deployed build then
completed the actual seven-action Flow and both private browser downloads.

The final code passed 79 Shopify tests, 47 root tests, nine authenticated browser
plan checks, type checking, lint and build. All 15 GitHub checks passed on the
deployed source. [Local evidence](allowance-verification.json) distinguishes
stubbed API checks from the real Shopify observations above. The Partner query
passes Shopify's schema validator. The Polaris validator failed to load its
JSX/Preact types after three attempts; installed types and actual browser checks
provide the retained UI verification instead.

## Documents and cleanup

Both one-page documents were visually inspected, including address handling,
order items, summary totals and omitted packing-slip prices:

- [Order summary PDF](previews/shopify-hosted-plans-order-summary.pdf)
  and [preview](previews/shopify-hosted-plans-order-summary.png).
- [Packing slip PDF](previews/shopify-hosted-plans-packing-slip.pdf)
  and [preview](previews/shopify-hosted-plans-packing-slip.png).

Uninstall also wrote an authenticated encrypted erasure instruction to the
independent recovery bucket and its transaction receipt to the database. The
monitor returned 200 with a fresh backup and no pending privacy requests.
Shopify still returned the Studio trial contract with cancellation scheduled at
its end; uninstall did not immediately make the subscription query null.

The app is uninstalled, its Flow is off and staging has zero active deployments.
Its private volume and recovery bucket are retained. The [launch budget](launch-budget.json)
records the $19 paid registration and approximately $0.0062 of Railway project
metering at shutdown. Metering may lag, is not an invoice and does not itemize
bucket charges. No new hosting subscription was purchased.

Before paid launch, verify paid-cycle renewal/cancellation and store freezes,
measure sustained capacity and costs, complete ongoing privacy/backup operation
and independent key recovery, finish listing/customer-data review, and recruit
consenting merchant pilots. The later [branded-origin check](branded-origin.md)
completed the URL migration and installed-app regression checks. These checks
do not establish the remaining launch outcomes.
