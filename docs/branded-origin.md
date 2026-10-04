# Branded Shopify origin and workflow verification

The October 4, 2026 attended check installed Fullbleed Commerce from
`https://commerce.fullbleed.dev` on the synthetic development store. The saved
visual and HTML/CSS template, manual PDF download, native Shopify Flow actions,
private document downloads, pause and real uninstall all passed. The app remains
an unsubmitted development preview; compute is stopped between attended tests.

The [retained verification](branded-origin-verification.json) identifies source
commit `aba1b199d3000a2940e6869cfe207a0fe35d5cfc`, the deployed build and Shopify
version `branded-origin-aba1b19`. Only `SHOPIFY_APP_URL` changed in the runtime
environment. The OAuth callback changed with the application URL; `read_orders`
and the relative Flow/webhook routes stayed the same. Shopify CLI accepted the
configuration. The private volume, recovery bucket and other variables were
preserved.

## Observed behavior

| Check | Result |
| --- | --- |
| Fresh app installation | Embedded app loaded from the branded HTTPS origin and accepted the existing development-store trial |
| Edit and save a template | Visual text edit and HTML/CSS accent edit survived navigation |
| Generate a manual PDF | Native browser download opened; the saved-template reprint matched the Flow summary bytes |
| Retry the existing Flow workflow on synthetic order #1004 | Seven actions completed: two document preparations, four private order-field updates and a diagnostic log |
| Download both Flow links | Chrome downloads matched preparation hashes; summary and packing slip each had one inspected page |
| Check usage | Manual generation, both document kinds and reprints shared one order unit |
| Pause automation | Both saved private links returned HTTP 410 |
| Uninstall through Shopify admin | Real uninstall webhook returned 204; all nine shop-data tables were empty; both links returned 404 |
| Verify erasure recovery | Encrypted erasure journal readback and transaction receipt were present |
| Stop staging | No active deployments; Flow off; private volume and recovery bucket retained |

This pass manually retried an existing Flow run. The earlier
[hosted workflow check](hosted-workflow.md) covers a new order-created trigger.
The synthetic order remained unpaid and unfulfilled. This pass did not approve
a new plan or exercise a real merchant payment.

The `/privacy` route redirects to the permanent
[documentation-site notice](https://docs.fullbleed.dev/commerce/privacy/) with
`Referrer-Policy: no-referrer` and without forwarding query parameters. The
notice remains accessible while app compute is stopped.

## Public walkthrough and documents

The [four-minute walkthrough](https://docs.fullbleed.dev/commerce/shopify/)
shows the actual installed app with English captions, including saved templates,
the existing Flow run, prepared document activity and pause. Idle intervals are
removed and playback is 1.3 times the recorded speed. The public page includes
the exact synthetic PDFs downloaded during this check:

- Custom summary: SHA-256
  `aeb000c5083537e8e0d32dc1fb040427e7ce0358184a8416e5dc0237facbe97a`.
- Contrast packing slip: SHA-256
  `253654a480086a67cc07a0e0a451aaf3268711f598ac2eb8d89cd2272cd2ed28`.

The [marketplace assets](marketplace/README.md) distinguish actual app
screenshots from the promotional feature artwork. Listing completion is not
Shopify approval.

## Validation and remaining work

Local schema/migration, recovery, type, lint, build and request-handler checks
passed, including 79 Shopify tests. Both initial source CI workflows passed
after one retry: the first PR pagination job exited with SIGSEGV (139), while
the parallel push job and same-commit retry passed. This is an unresolved native
failure, tracked in
[fullbleed-node #7](https://github.com/fullbleed-engine/fullbleed-node/issues/7),
not a verified fix.

The [hosted launch requirements](hosted-plans.md) still include protected
customer-data review, paid billing lifecycle and store-freeze checks, sustained
capacity and cost measurement, independent key recovery, continuous privacy and
backup operations, platform review and consenting merchant pilots. No production
availability, paid purchase, merchant adoption or marketplace approval is claimed.
The [launch budget](launch-budget.json) records the $19 registration charge and
separate, lagging hosting meter. No new hosting subscription was purchased.
