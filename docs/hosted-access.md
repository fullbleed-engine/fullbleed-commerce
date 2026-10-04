# Hosted access history and recovery

On October 4, 2026, the merged access-history candidate
`d5ef84a89b1b765aa5bfd1ebf2e33e85e8642e4d` was deployed temporarily to
`commerce.fullbleed.dev` and installed on the synthetic development store.
The [verification record](hosted-access-verification.json) retains the image,
source and PDF hashes, browser results, real uninstall delivery and cleanup.

| Check | Observed result |
| --- | --- |
| Retained-volume migration | AccessEvent migration applied; all merchant-data tables initially empty |
| Staff generation and history | Verified Shopify staff identity recorded; desktop and mobile history inspected |
| Existing synthetic Flow retried | Seven actions completed; both document jobs ready on their first attempts |
| Actual Flow links from order fields | Both PDFs downloaded in Chrome and matched Shopify's recorded hashes |
| Restricted third-party cookies | Fresh Chrome context blocked the canary cookie; authenticated history and PDF download worked with no app cookies |
| Synthetic customer export | Six matching order-access events included; staff identifiers omitted |
| Request completion and customer deletion | Encrypted export and corresponding access references erased |
| Pause automation | Both private links returned 410 |
| Uninstall through Shopify admin | Actual webhook returned 204; all ten merchant-data tables empty; links returned 404 |
| Restore the earlier backup in quarantine | Three later erasure intents replayed; all ten tables empty, sessions cleared and automation paused |

The privacy request and customer deletion were operator-signed synthetic
fixtures. The install, Flow actions, order fields, embedded authentication,
downloads and uninstall used the real Shopify development store. This check
retried an existing workflow; the earlier [workflow verification](hosted-workflow.md)
covers a new-order trigger. No customer email, payment or fulfillment occurred.

The summary matched both the manual download and the restricted-cookie download
byte for byte. Both one-page PDFs were visually inspected. Access history
records completed operations, not proof that a recipient received or read a
document. Collection reads record the operation; direct provider, database and
operator actions remain outside this application history.

The isolated restore did not replace the live database, and its temporary
directory was removed. The app is uninstalled, the Flow is off and Railway
reports zero active deployments. The private volume and recovery bucket remain
retained. [Launch spending](launch-budget.json) remains $19 in confirmed charges,
with about $0.0082 of project usage reported at shutdown; metering can lag and
is not an invoice.

## Recovery contention found during CI

The main-branch integration run
[37192607148](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37192607148)
failed in the monitor test's backup setup while startup cleanup was also
running. Its recovery binding transaction returned Prisma P2028. A separate,
controlled two-client reproduction showed an already-bound dataset check
timing out behind an open writer with P1008, although a normal read succeeded.
These are related contention observations; the reproduction did not produce
the identical CI error code.

Existing dataset verification now authenticates recovery storage and reads the
immutable marker without opening another write transaction. A second controlled
check exposed the same lock problem when replay inspected an already-committed
erasure receipt. Those receipts are now also checked without a writer lock,
after every journal object has been authenticated. Initial binding and missing
receipts still recheck and mutate transactionally. Tests hold a writer open
until verification completes and reject conflicting markers or unavailable
storage. No timeout was increased and no test retry was added.

The hosted candidate above predates this correction. Validation of the
correction is recorded separately in the pull request; the hosted results must
not be presented as a deployment of the later fix.

This rehearsal does not establish App Store approval, operational access
controls, independent key recovery, ongoing monitoring coverage or the full
paid billing lifecycle. Those [launch requirements](hosted-plans.md) remain.
