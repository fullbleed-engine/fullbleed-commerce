# Preview verification

Checked locally on October 2, 2026. This evidence covers the 0.1.0-alpha.1
preview, not marketplace approval or a live paid service. All order data used
was synthetic. No merchant store was changed and no customer PDF was retained.

## Executed checks

| Surface | Result | Retained evidence |
| --- | --- | --- |
| Node renderer, Shopify adapter/access/forms, browser-worker runtime, admin workflows and monitoring client | 41 tests passed | `output/node-tests.log` |
| WordPress/WooCommerce, free plugin with legacy storage | 46 HTTP checks passed; HPOS disabled in runtime | `output/wordpress/legacy-free-verification.json`, `legacy-free-runtime.json` |
| WordPress/WooCommerce, installed base and Pro ZIPs with HPOS | 46 HTTP checks passed; HPOS enabled in runtime | `output/wordpress/packaged-hpos-pro-verification.json`, `packaged-hpos-pro-runtime.json` |
| Six designed sample PDFs | Each one page, zero reported missing glyphs | `output/examples/verification.json` and matching PDFs/PNGs |
| Sixty-item long order summary and packing slip | Eight pages each; every SKU retained; text bounds inside pages | `output/pdf-text-verification.json`, `output/layout/` |
| Shopify application migrations, route types, TypeScript, lint, production build and request-handler tests | All checks passed; two readiness, four application, eight Flow, 15 privacy and five monitoring tests passed | `output/shopify/verification.json` and matching test logs |
| Linux production container | Seven checks: unprivileged server, missing-volume refusal, fresh root-owned mount, private files, authentication, persistence through replacement and privacy monitor | [CI record](ci-verification.json) |
| Railway staging | HTTPS/authentication checks, eight byte-identical commerce PDFs, enforced 0.5 CPU / 512 MiB limits and persistent branding/jobs through replacement | [Hosted evidence](staging-verification.json) |
| Hosted monitoring drill | GitHub healthy check, expected synthetic privacy-deadline failure and healthy recovery; private endpoint rejects missing/wrong tokens; public logs contain no credential or queue payload | [Monitoring evidence](monitoring-verification.json) |
| Privacy requests in real Chrome with synthetic Shopify sessions | 13 browser checks: encrypted snapshot download, exact large IDs, explicit completion, erasure, overdue notice and 390px layout | `output/browser/shopify-privacy-verification.json`, JSON download and screenshots |
| Shopify Flow extensions | CLI validates both native actions and output schemas | `output/shopify/flow-config-validation.json` |
| Actual Shopify Flow execution and browser downloads | 19 retained checks; both actions and the downstream step completed; downloaded PDFs match returned SHA-256 values; revoke and pause return HTTP 410 | `output/browser/shopify-flow-verification.json`, matching PDFs/PNGs |
| Visual and source template editing in real Chrome 154 | Free editor saves, previews, reloads and resets; Pro also downloads a two-PDF ZIP and fits a 390px viewport | `output/browser/*-verification.json`, PDFs and screenshots |
| Shopify real-browser editing and downloads | Summary/packing-slip downloads, visual edit, HTML/CSS save, actual preview, persisted template and reset passed | `output/browser/shopify-verification.json` |
| Custom template rendering | Summary and packing slip: one page, zero missing glyphs, deterministic output; embedded PNG verified | `output/templates/verification.json` |
| Pro automation with HPOS and legacy WooCommerce | 27 checks in each; actual queued-email handler and captured PHPMailer MIME contain the exact rendered PDF; no email sent | `output/automation/woocommerce-*.json`, PDFs and MIME |
| Customer account downloads from freshly installed ZIPs | 35 checks in each of HPOS and legacy storage; real login, account pages, ownership, nonces, statuses/refunds, private downloads, cooldown and outage recovery | `output/automation/customer-*.json` and matching PDFs |
| Customer portal in real Chrome 154 | 12 checks: desktop/mobile account actions, native PDF download, merchant enable/disable and staff browser-worker parity | `output/browser/wordpress-customer-verification.json`, PDF and screenshots |
| Automation settings over HTTP | 12 permission, nonce, separate customer opt-in, consent withdrawal, secret handling and disconnect checks passed | `output/automation/settings-http.json` |
| Dependency audits | Zero reported vulnerabilities in both dependency trees at check time | `output/npm-audit.json`, `output/shopify/npm-audit.json` |
| Shopify installation and test fixture | Installed offline `read_orders` session; verified development-store identity; synthetic draft completed unpaid | `output/shopify/installed-store/verification.json`, `output/shopify/test-store-after.json` |
| Live Shopify API to Fullbleed renderer | All six document/design variants rendered; one page each, zero missing glyphs | `output/shopify/installed-store/verification.json` and matching PDFs/PNGs |

The tested store ran WordPress 7.1.2, WooCommerce 11.1.2 and PHP 8.3.33.
The renderer was the published Fullbleed Node 0.1.1 package, with engine 2.5.5.
The engine, fonts and compiled JavaScript served by the installed WordPress ZIPs
matched the local packaged assets byte for byte. ZIP hashes are in
`dist/SHA256SUMS.txt`; the retained summary is [verification.json](verification.json).

ZIP timestamps use fixed local DOS fields so packaging is independent of timezone.
The final base and Pro ZIPs were freshly installed and activated together on the
HPOS store through Playground. The earlier free legacy installation received only
frontend asset refreshes. All twelve final served-asset comparisons passed.
The retained record identifies the exact newly installed archive hashes.

For the customer-download milestone, both ZIPs were freshly installed on separate
HPOS and legacy stores. Every installed entry was compared with its archive bytes.
The free ZIP is unchanged; the Pro ZIP adds the customer portal. Customer and
staff browser downloads have the same SHA-256 as the Node renderer's saved-template
fixture. The one-page PDF and desktop/mobile account layouts were visually inspected.

The HTTP checks exercised logged-in administrators and shop managers, denied
anonymous users, editors and subscribers, rejected missing or invalid nonces,
preserved store display amounts, and rejected refunded orders. The Shopify route
tests verified authentication and entitlement before order reads, tenant selection
from the authenticated session, GraphQL variables, currency consistency and real
PDF output. These route tests use fixtures. The separate installed-store check
uses the real Shopify API. After protected-customer-data access was saved, all
six variants rendered from the tagged synthetic unpaid order. The Studio and
Contrast order summaries and Quiet packing slip were visually inspected.

The production React Router handler verifies signed privacy/uninstall webhooks,
rejects forged signatures, preserves another shop's records, deletes the target
shop's sessions, branding and saved templates, accepts replay, and prevents unauthenticated PDF
requests from returning documents. It also checks concurrent template saves and
merchant isolation, and renders the Documents component to catch disabled-button
regressions in Polaris custom elements. React and React DOM are pinned to 19.3.0;
Polaris script/types are pinned to the 1.1 track. These checks use an isolated synthetic SQLite
database, not the installed development app's database.

Privacy request tests exercise signed raw JSON, including numeric IDs beyond
JavaScript's safe integer range, durable deduplication, captured metadata,
authenticated tenant-scoped exports without billing or new Admin API reads,
email-only and order-reference erasure, completion, key mismatch, ciphertext
swaps, terminal retention, pagination and batched SQL parameters. Uninstall
removes the export associations; late requests fail without recreating them.
An aggregate-only operator command reports pending/near-due/overdue requests
and mismatched keys. The [privacy runbook](../shopify/PRIVACY.md) describes the
remaining deployment and response responsibilities.

The read-only monitoring endpoint uses a separate scoped token. Tests reject
bad credentials and malformed/stale responses, verify impending/overdue deadline
and key-mismatch failures, and prohibit Shopify or billing calls. The hosted
GitHub drill accepted an empty queue, failed for a synthetic request due in 24
hours, and recovered after exact fixture cleanup. Public readiness stayed healthy
through the privacy warning. The public workflow log was checked for accidental
credential or queue disclosure. Scheduling remains disabled while compute is
stopped; operator notification receipt and missed-check detection are unverified.
See [monitoring operation](../shopify/MONITORING.md).

The privacy browser fixture uses the production build and official SDK JWT
verification with synthetic sessions. Only the external Shopify admin/App Bridge
shell is replaced; Polaris components, React hydration, forms and downloads run
in Chrome. This is separate from the earlier installed-store editor/Flow checks,
and does not verify live privacy subscriptions or delivery to a store owner.

Flow tests exercise the production request handler and official HMAC validation,
including authenticated tenant/subscription checks before order reads. They cover
durable action-run deduplication, competing database clients, expired leases,
transient backoff, manual retry, altered inputs, forged/expired/revoked links,
pause/uninstall during rendering, customer redaction and 30-day cleanup. The
network boundary is synthetic; PDF rendering and database operations are real.

Separately, the installed development app completed a real Shopify Flow workflow
on synthetic unpaid order #1001. Both document actions returned values consumed
by a following Liquid step, which logged only identifiers, PDF hashes, expiry
times and hashes of private URLs. Chrome downloaded both returned links; the
bytes matched Flow's SHA-256 values. Both one-page PDFs and the desktop/390px
download pages were visually inspected. Individual revocation and pause blocked
subsequent downloads without incrementing their counters. The workflow and app
automation were left disabled, and all test links revoked. This used Shopify's
manual replay of the Order created trigger, not a newly placed order or actual
customer email. The [Flow contract](../shopify/FLOW.md) documents that boundary.

The worker tests execute the actual bundled WebAssembly engine in a Node VM with
browser APIs supplied by the test harness, and compare its PDF with Node output.
Admin tests use JSDOM and real generated PDFs to check download invalidation,
complete ZIP batches, permission failure, retry and render timeout. Neither is a
real Chrome, Safari or mobile-browser test.

All three order-summary designs were visually inspected. The long-order checks
exposed an orphan closing section on the packing slip; its layout was corrected,
rerendered and the final eighth page inspected. PDF text extraction checks support
these fixtures; they are not a general proof of non-overlap, accessibility or ISO
conformance.

Automation tests substitute only the renderer HTTPS transport with a WordPress
test filter; they use actual Fullbleed output for that exact order. A separate
Node test exercises the standalone HTTP service with authentication. Production
TLS/proxy configuration and real mail delivery are not verified. Windows
Playground does not expose Unix mode bits; the Linux job checks private temporary
file permissions. Automatic retry of a missing attachment and third-party mail
queues remain release work. See [automation setup](../automation/README.md) and
the [product plan](product-plan.md).

Customer download tests use actual WordPress sessions and HTTP responses, with
only the renderer HTTPS response substituted. A valid nonce for someone else's,
guest, missing or refunded order still fails ownership/eligibility checks.
Denials never call the renderer. Errors do not reveal remote response bodies or
credentials. In-request reassignment, cancellation and disconnect during the
renderer call prevent PDF bytes from being returned; a later successful retry
clears the merchant's failure indicator. These tests use the default WooCommerce
cache configuration. Persistent cache plugins and concurrent changes across
separate PHP workers need staging verification before a paid production claim.
Guest-access links, fiscal invoices and an immutable document archive are not
implemented. Account downloads are current summaries using the current template.

## Reproduce

Use Node.js 24.18+ and Python with `requests` and `pymupdf` for the HTTP and PDF
text checks:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run examples
node tools/check-layout.mjs
python tools/check-pdf-text.py
npm run pack
node tools/check-automation.mjs --hpos
node tools/check-automation.mjs
node tools/check-customer-downloads.mjs --hpos --packages
node tools/check-customer-downloads.mjs --packages
npm --prefix shopify/app ci --ignore-scripts
node tools/check-shopify.mjs
node tools/wordpress.mjs --pro --hpos --packages
```

While the disposable local store is running, run `python tools/check-wordpress.py`
in a second terminal. Stop that store before starting the free legacy variant,
`node tools/wordpress.mjs`. Both use loopback port 9475 and synthetic credentials.
WordPress Playground currently downloads its latest WordPress and WooCommerce;
retain its runtime record because later runs may use different versions.

For the customer portal's browser check, run
`node tools/check-customer-downloads.mjs --hpos --packages --serve` and leave that
synthetic store running on port 9482. In a second terminal run
`python tools/check-customer-browser.py`. It opens its own headless Chrome context
with synthetic customer and administrator accounts; no existing browser is used.

## Hosted staging

The final container was deployed to a separate Railway project in the United
States. The host served the privacy disclosure and database readiness endpoint,
denied forged webhooks and required Shopify authentication for documents. Its
actual server ran as `node`; the volume and SQLite file had private permissions.
Synthetic branding and a pending job survived replacement deployments. The
synthetic records were cleared after verification.

The deployed Fullbleed module rendered all six designed fixtures and both
60-item, eight-page fixtures. Every PDF matched its previously verified local
file byte for byte. Sequential renders took 242–750 ms under the observed
0.5 CPU / 512 MiB ceiling; the probe process peaked at 158,204 KiB RSS. This is
a small synthetic sample, not a concurrency benchmark, end-to-end Shopify
workflow measurement or production capacity promise.

The final infrastructure plan matched the live service. After testing, compute
was stopped and the persistent volume retained. The host is not currently
serving merchants. Billing, full installation, automatic Flow delivery, alert receipt
and backup/erasure recovery remain separate gates. See
[deployment operation](../shopify/DEPLOYMENT.md) and the
[retained hosted record](staging-verification.json).

## Release work still required

- Real-browser desktop and mobile workflow checks, including downloads, worker
  execution, previews, accessibility and different hosting security policies.
  WooCommerce and Shopify have passed real Chrome checks. Shopify saves use a
  resource route so fetch receives JSON/PDF rather than document HTML, and the
  editor dependencies are prebundled before navigation. Safari and other hosting
  security policies remain untested.
- Representative merchant staging orders, variations, long addresses and supported
  character sets. This preview rejects missing glyphs and refunds; it does not
  implement fiscal invoices or recalculate taxes.
- Paid purchase, delivery, update and support setup for the separate Pro add-on.
  No checkout, licensing server or renewal workflow exists yet.
- Shopify live entitlement lifecycle checks, production operation and App Store review.
  The Partner organization, registered app, development store, installation and
  access to the synthetic order are verified. Billing configuration and
  production merchant rollout are not complete. The isolated staging container
  deployment and persistent storage have now been verified.
- Shopify webhook monitoring, privacy-alert receipt, backup erasure and secure support-delivery setup,
  automatic new-order trigger testing,
  and a real configured delivery destination remain required. Native Flow actions
  have been tested through manual replay on the synthetic store. Public
  distribution is selected; that is not App Store approval or publication.
- The Shopify toolkit's Polaris validator could not resolve its own
  `preact/jsx-runtime` and JSX types after three attempts, including a minimal
  component. The app's installed Polaris types pass TypeScript and production
  build checks; this does not substitute for real-browser QA.

The final [Linux CI run](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37084217014)
passed clean dependency installation, all 41 shared tests, plugin packaging,
28 WooCommerce email automation checks, 35 customer-download checks in each
order-storage mode, two readiness tests, four Shopify application tests, eight
Flow tests, 15 privacy tests, five monitoring tests and all seven production-container checks. Linux
also verified restrictive attachment
file permissions. Both plugin archives are byte-identical to the Windows packages
installed for browser checks. Both customer-summary PDFs and the Flow fixture
PDF are identical across both operating systems. The retained [CI record](ci-verification.json)
identifies the checked source commit, archive hashes and individual automation
results. No production merchant credentials were supplied to CI.

Spending remains recorded separately in [launch-budget.json](launch-budget.json).
