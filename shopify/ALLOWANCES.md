# Order allowances

Fullbleed counts **unique orders successfully processed in a Shopify billing
period**, rather than charging for every PDF. The Studio candidate includes 250
orders at USD 12 per 30 days; Scale includes 1,000 at USD 29 per 30 days. Both
include saved designs, visual and HTML/CSS editing, both document types, Flow
actions and private links. These are launch candidates, not evidence of paying
merchant adoption or sustained hosted capacity. Both definitions are saved in
Shopify App Pricing with seven-day trials and no usage meters; the
[dashboard readback](../docs/plan-configuration.json) records the configuration.
The app remains unsubmitted to the App Store.

An order's first successful PDF, template preview or Flow preparation consumes
one unit. Its order summary, packing slip, later previews, reprints, automation
runs and private-link downloads share that unit for the same billing period.
Processing the same order in a later period consumes a unit in that period.
Unused units do not roll over. Failed work releases its reservation. There are
no usage charges or automatic overages. At the limit, existing counted orders
remain available; new orders require an approved plan change or renewal.

The app's Plan and usage screen shows completed work, active reservations,
available orders and the current period end. Plan changes leave the app through
the Shopify SDK's top-frame pricing redirect. Flow failures name the allowance
limit and tell the merchant to retry preparation after upgrading or renewal,
then rerun the failed workflow to continue its later steps.

## Subscription authority

The current Partner API `activeSubscription.items[].handle` selects the plan.
`SHOPIFY_PLAN_HANDLES` must explicitly allow it, and `shopify/usage.js` must know
its allowance. Use `studio,scale,shopify-test` while testing the two candidates
and the existing private zero-price plan. Do not accept a plan from a return URL,
an order field, a browser form or a pending subscription update. Catalog price
retirement does not invalidate an active contract.

The usage key derives from Shopify's current billing-cycle start, independent
of plan handle. Changing plans within that cycle preserves usage. Pending
downgrades take effect only when Shopify returns the new active plan. Trial
subscriptions with no current cycle use the trial end as their separate key;
the first paid cycle then starts its own allowance. Invalid or expired period
metadata fails closed. Annual plans are not implemented.

## Durable accounting and privacy

SQLite transactions reserve a unique `(period, order)` row before fetching or
rendering. Pending reservations occupy a slot for at most 90 seconds; work has a
60-second deadline. A failed task releases its reservation, while an expired
worker cannot commit after another worker replaces it. Successful completion
increments the period's aggregate once. A worker must still own its receipt
after rendering, including reprints; erasure or uninstall prevents completion.
The process render limit remains two total and one per store.

No order contents, customer names, addresses or PDFs are added to storage.
Order references, successful processing times and billing dates are included in
customer data exports. Redaction clears the references and pending work while
preserving only the aggregate count. Uninstall clears both tables. Periods are
removed 30 days after their end by startup/hourly cleanup. Encrypted backup
recovery migrates the isolated restored database before replaying erasures and
clears pending reservations before promotion.

## Verification and launch boundary

`node tools/check-shopify.mjs` covers actual SQLite clients, collisions, final
slots, reprints, failed work, restart leases, plan changes, trial/cycle bounds,
privacy export, erasure races, uninstall and older-schema backup recovery. It
also renders through authenticated manual, template and Flow production routes
against synthetic Shopify responses. `node tools/serve-plans-fixture.mjs` plus
`python tools/check-plans-browser.py` checks the built UI and real browser PDF
download with the Shopify API and admin shell stubbed. Retain the logs and
hashes under `output/shopify/` and `output/browser/`.

The Partner GraphQL query validates against the 2026-07 schema. The Shopify
Polaris validator currently fails to load its own JSX/Preact types, including
for a reduced HTML fixture. Repository type checking uses the installed Polaris
1.1 types; real browser rendering and mobile layout are checked separately.

Before offering these plans to paying merchants, exercise approval, upgrades,
downgrades and cancellation on the installed development store; measure the
hosted workload and operating costs described in [CAPACITY.md](CAPACITY.md);
complete privacy operations and marketplace review. The fixed allowance alone
does not establish production capacity. Shopify's own development stores test
the intended plan with zero effective charges, not a real merchant payment.

Sources checked October 4, 2026: [Shopify App Pricing plans](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans),
[subscription setup](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-subscription-charges),
[active subscription](https://shopify.dev/docs/api/partner/2026-07/objects/ActiveSubscription)
and [billing cycle](https://shopify.dev/docs/api/partner/2026-07/objects/BillingCycle).
