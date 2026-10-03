# Preview verification

The current WordPress release is **0.1.1**, published October 3, 2026.
All checks use synthetic order data. This is an evaluation preview, not
marketplace approval or a live paid service.

## 0.1.1 release verification

The release pins the public Fullbleed Node 0.1.2 package, containing engine
2.5.6. Build metadata and the copied WebAssembly checksum are checked against
the installed package. Browser PDF checks independently extract custom bold
headings and require each heading exactly once. The upgrade fixture starts from
the actual alpha.3 archives and requires the new failure alerts to remain off.

The [retained release record](release-011-verification.json) identifies the exact
source and package hashes. Both ZIPs match Windows and Linux builds, and all six
[release assets](https://github.com/fullbleed-engine/fullbleed-commerce/releases/tag/v0.1.1)
were downloaded without authentication and compared with the verified local files.
The release includes a permanent evidence ZIP with synthetic PDFs, previews and
machine-readable reports.

All 45 shared tests pass. Each of Chrome, Playwright Firefox and Playwright WebKit
passes 13 staff, 13 customer and 10 alert checks on Linux, with no page errors.
Windows Chrome passes the 26 staff/customer checks with identical fixture PDFs.
Both order-storage modes pass 23 real ZIP-upgrade checks, 84 email/activity/alert
checks and 38 customer authorization checks on Linux. Native WordPress passes
strict Plugin Check and 12 Chrome checks. The private renderer/TLS/SMTP deployment
passes 72 checks, including queued delivery and explicit recovery. The six design
examples, customized browser PDFs and distinct SMTP PDF pages were visually
inspected. These results cover this release; older records below retain their
original source and renderer versions.

The first Windows browser runner completed the staff journey, then reached its
ten-minute customer-fixture readiness cap before launching that browser. The same
standalone customer fixture subsequently passed all 38 HTTP checks and 13 browser
checks. The original log and recovery evidence are retained.

The previous main-branch Chrome run failed its strict JavaScript-error check in
the alert journey after the other nine checks passed. That failure did not retain
the error text. A local baseline rerun passed; its cause has not been established.
The checker now retains the exception, browser metadata, page-error stacks and
console details on failure. The zero-page-errors requirement remains unchanged.

## Administrator failure alerts added after alpha.3

Current source adds opt-in administrator summaries for unresolved WooCommerce
document failures. [Retained verification](failure-alert-verification.json)
records the runtime source hashes, synthetic MIME/PDF hashes and each local check.
Both HPOS and legacy stores pass 83 email/activity/alert checks on Windows,
including interleaved reservations, lost cache, rejected and interrupted mail,
recovery, missing storage, retention and uninstall. Mail is captured before
transport; these tests send no email and do not prove inbox delivery.

Chrome passes ten alert-control checks covering enable/save/reload/disable,
administrator permission, CSRF protection, mobile layout and page errors. Twelve
activity checks also pass, including the real staff browser-worker PDF download.
The shared 45-test Node suite and all six designed examples pass. The production
loop is still gated on a working merchant scheduler and actual mail receipt.
These source additions do not change the published alpha.3 artifacts.

## Native queued email and SMTP receipt

[Retained SMTP verification](smtp-verification.json) records 21 additional checks
within the 72-check native renderer deployment run. WooCommerce 11.1.2 on
WordPress 7.1.2 queues a real synthetic order transition in Action Scheduler.
A separate native `wp-cron.php` process renders through HTTPS and sends through
the unmodified WordPress mailer to a private Mailpit server. This exercises the
queue and SMTP transport; the fixture does not invoke the email handler directly
or replace PHPMailer's send method. Only the scheduled due times are advanced.

The inbox receives four messages: the processing email with its PDF, an outage
email without an attachment, an administrator failure summary, and an explicit
recovery resend with its PDF. A WordPress container restart preserves alert
cooldown. Repeated scheduler runs neither duplicate completed customer mail nor
resend it when rendering recovers. Both received PDFs match the reference bytes
and contain all 36 line items exactly once across three pages, verified with an
independent PDF parser. All distinct page images were visually inspected.
Temporary attachment files are private and removed after sending.

The network has no public SMTP/mailbox ports or external relay. This proves
receipt in the isolated inbox, not external-provider deliverability or a merchant
host's scheduler. HPOS is used here; separate captured-mail tests cover legacy
storage. The source Pro package includes unreleased failure alerts and does not
replace the public alpha.3 ZIP. Follow the
[staging acceptance sequence](../automation/DEPLOYMENT.md#check-the-complete-staging-workflow)
before enabling a merchant workflow.

## Historical alpha.3 release and upgrade path

[Alpha.3](https://github.com/fullbleed-engine/fullbleed-commerce/releases/tag/v0.1.0-alpha.3)
packages the merchant activity view and the editor built with WordPress's shared
libraries. The [browser demo](https://playground.wordpress.net/?storage=temp&blueprint-url=https://raw.githubusercontent.com/fullbleed-engine/fullbleed-commerce/main/playground/blueprint.json)
uses the free package. The separate Pro ZIP includes automation activity; the
demo does not enable automatic emails, customer downloads or a hosted service.

The upgrade check downloads the real alpha.2 archives with pinned checksums,
installs them in a disposable store, saves both templates and their revisions,
and enables synthetic automation settings. WordPress's `Plugin_Upgrader`
replaces the base ZIP first, then Pro. Twenty checks pass in each of HPOS and
legacy storage: installed files match the new archives, obsolete files are
removed, both plugins remain active, settings and order data survive, no mail
is sent, and the activity schema and retention job initialize on the next
request. The same saved input produces identical Node-rendered PDF bytes.

Real Chrome separately checks the saved design after upgrade, editing and PDF
preview, ordinary and batch downloads, WordPress's shared libraries, reset and
mobile layout. The [alpha.3 verification record](alpha3-release-verification.json)
retains exact source, archive hashes, CI and browser results. Historical runs
below cover their original source commits and are not automatically reclassified
as alpha.3 results.

The release's public sample store passes 13 checks in the existing authorized
Chrome session. All five PDF artifacts match the local demo byte for byte.
A separate fresh headless browser stopped at Playground's human-verification
page; that attempt is retained as blocked and no challenge was automated.

Linux CI passes 45 shared tests, 60 email/activity checks and 38 customer-download
checks in each storage mode, plus the renderer, Shopify and container jobs.
The native WordPress job passes strict Plugin Check and 11 Chrome checks.
Both public ZIPs and metadata download without authentication and match the
Windows and Linux archives. These checks do not establish merchant production
email delivery, a paid lifecycle or marketplace approval.

Upgrade on staging by uploading the base ZIP and choosing **Replace current
with uploaded**, then repeat for Pro if installed. Export templates and back up
the store first. Existing enabled workflows stay enabled; check the connection
and a synthetic order after updating. There is no automatic updater in this preview.

## Browser workflow matrix

The released alpha.3 base and Pro ZIPs pass **12 merchant checks and 12 customer
checks in each of six browser/OS combinations**. The runtime packages are
unchanged. [Retained evidence](browser-workflow-verification.json) records the
package hashes, browser versions, source commits, checks and downloaded PDFs.

| Browser distribution | Windows | Linux CI |
| --- | --- | --- |
| Google Chrome channel | 154.0.8037.93 | 154.0.8037.97 |
| Playwright Firefox | 155.0 | 155.0 |
| Playwright WebKit | 26.6 | 26.6 |

These use Playwright 1.63.0 and disposable WordPress 7.1.2 / WooCommerce 11.1.2 /
PHP 8.3.33 stores with HPOS. Merchant checks cover actual worker PDFs, drag/drop,
visual text editing, HTML/CSS save and reload, batch ZIPs, reset, WordPress shared
library identity and a 390px viewport. Customer checks cover native My Account
downloads, order details, saved styling, staff/server PDF parity, and immediate
revocation after the merchant disables downloads. Uncaught JavaScript errors
fail the journeys.

The default, customized, saved, batch and customer PDFs are byte-identical
across these six combinations. Final default, customized and customer PDF pages
were rendered with Fullbleed 2.5.5 and visually inspected. The Linux matrix also
runs the 38-check customer HTTP/authorization fixture separately in each job.
The [native WordPress directory job](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37117473561)
passes Plugin Check and the free editor in Chrome; native WordPress coverage
has not been broadened to the other two browsers.

The [browser workflow](../.github/workflows/browser-workflows.yml) installs pinned
Python dependencies from `tools/browser-requirements.txt`, installs the selected
Playwright browser and runs `node tools/check-browser-workflows.mjs` after build
and packaging. Set `FULLBLEED_TEST_BROWSER` to `chrome`, `firefox` or `webkit`;
set `FULLBLEED_TEST_PYTHON` when using a virtual environment. The runner owns
loopback ports 9496 and 9482, refuses to replace existing services, and closes
its fixture processes. Failure records include the original exception, browser
metadata and screenshots; merchant failures also retain a Playwright trace.

[Playwright's browser documentation](https://playwright.dev/python/docs/browsers)
distinguishes its Firefox/WebKit distributions from branded browsers. This is
**not Safari, macOS, iOS or physical-device verification**. A narrow viewport
does not establish full mobile editor usability. Preview PDF bytes and downloads
are checked; embedded PDF-viewer rendering remains browser-dependent. Customer
rendering uses an HTTPS test filter around actual Fullbleed output, so these
checks do not establish production service availability or email delivery.
Merchant pilots, paid purchase/update delivery and marketplace approval remain
separate launch gates.

## Alpha.2 release evidence (historical)

The [release](https://github.com/fullbleed-engine/fullbleed-commerce/releases/tag/v0.1.0-alpha.2)
and [browser demo](https://playground.wordpress.net/?storage=temp&blueprint-url=https://raw.githubusercontent.com/fullbleed-engine/fullbleed-commerce/main/playground/blueprint.json)
are public. The [merchant guide](https://docs.fullbleed.dev/guides/woocommerce/)
includes an actual PDF downloaded from the demo. The free plugin's editor and
browser PDFs run there; Pro automation is not enabled in the sample store.

Public testing exposed a startup race: controls could be used before their
scripts initialized, causing an ordinary form submission. Alpha.2 keeps them
disabled, explains the loading state and waits for installed add-ons as well as
the base tools. Deliberately delayed base and Pro requests now pass real Chrome
checks, including Enter during startup and a PDF download after initialization.

| Surface | Result |
| --- | --- |
| Shared Node tests | 44 passed, including delayed add-on registration |
| Released packages | Both ZIPs and metadata downloaded without authentication; checksums match local files and the Linux build |
| Synthetic demo runtime | Seven checks on Windows and Linux: exact ZIP, HPOS, fictional unpaid orders, preserved amounts, blocked mail/networking and disabled cron/tracking |
| Public Chrome demo | 13 checks: temporary storage, real downloads, 32-item summary and packing slip, visual/source editing, saved templates, reset and 390px layout |
| Local Chrome demo | 12 checks; all five PDF downloads match the public demo byte for byte |
| Delayed script loading | 11 real Chrome checks covering the base plugin and Pro |
| Pro Chrome workflow | 11 checks, including persistent templates and an actual two-PDF ZIP |
| Linux WooCommerce automation | 28 email checks and 35 customer-download checks in each of HPOS and legacy storage; exact installed ZIP entries and private temporary permissions checked |
| Linux Shopify and container jobs | Both jobs passed; this does not re-run the historical hosted or installed-store drills |
| Public guide | Deployment passed; canonical/demo/release links, homepage discovery and published sample asset hashes verified |

The [retained release record](preview-release-verification.json) ties these checks
to release commit `2cdb283` and [Linux CI](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37100093017)
at `7276f8e`. The only intervening changes are navigation waits in three browser
test scripts, subsequently exercised locally. Runtime and packaged source did
not change after that CI run. The record includes archive and document hashes,
the exact browser checks and the guide deployment.

The 32-item summary preserves all items and amounts across four pages, but its
closing section occupies the final page by itself. This check establishes content
retention for that fixture, not perfect pagination for every merchant template.
Safari, other hosting policies, merchant fixtures and paid lifecycle checks
remain open. Mail/customer automation still uses a test transport around actual
WordPress hooks and Fullbleed PDF output; no production email delivery is claimed.

To refresh this delta after executing its checks and downloading the matching CI
artifact, run `node tools/retain-preview-verification.mjs alpha2 target/alpha2-ci`.
Keep the historical whole-product records below separate from this release delta.

<a id="unreleased-wordpress-directory-preparation"></a>

## WordPress directory preparation

### WordPress directory submission

The free **0.1.0** directory preview was submitted October 3, 2026 by maintainer
`kfinkelstein`, with assigned slug `fullbleed-commerce`. WordPress.org accepted
the archive and reported that its automated scan passed. The submission is
**Awaiting Review**; it is not approved or listed. The
[submission record](wordpress-submission.json) retains the archive hash, native
directory check, upgrade evidence and confirmation image.

WordPress requires numeric versions. This candidate changes the alpha.3 free
ZIP's PHP header/asset version and readme contributor/version/changelog; the
other 37 entries are byte-identical. The Windows build, Linux CI package and
archive downloaded back from WordPress.org are byte-identical. Existing
staging-preview limitations remain. Pro and the public GitHub alpha.3 release
are separate from this directory submission.

The final candidate passes strict Plugin Check and 11 native WordPress/Chrome
editor and PDF checks. Both HPOS and legacy upgrade fixtures pass 21 checks,
including retained templates/settings and WordPress's version ordering from
alpha.3 to 0.1.0. Default and custom PDF hashes match the previously inspected
release output. These checks do not establish merchant production operation,
paid purchasing or WordPress.org approval.

### Source and native verification

The free editor now uses WordPress's Backbone, Underscore and CodeMirror instead
of the copies embedded in the upstream GrapesJS bundle. GrapesJS is rebuilt from
the source map in its locked npm release. A private Backbone View adapter keeps
its Cash DOM handling and undo registration from changing WordPress's shared
constructors or jQuery adapter. Required source, build instructions and additional
dependency notices are included in the ZIP.

The [native directory job](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37108889980)
passes WordPress Plugin Check 2.1.0 in strict mode with no reported errors or
warnings, followed by **11 real Chrome checks** on the installed free ZIP.
WordPress 7.1.2, WooCommerce 11.1.2 and PHP 8.3 are used. Experimental Plugin Check
checks are not enabled. Two narrow inline exceptions are documented: a prepared
atomic template revision update, and read-only order-ID prefilling whose later
REST request is independently authorized.

The Windows Pro fixture passes **12 Chrome checks**, including an actual two-PDF
ZIP. Both browser runs exercise drag-and-drop, visual text editing, HTML/CSS,
save/reload, real PDF preview, reset and mobile width without JavaScript errors.
The default, customized and saved PDF downloads match byte for byte across the
two operating systems. The [default PDF preview](previews/woocommerce-wordpress-default.png)
and [customized PDF preview](previews/woocommerce-wordpress-custom.png) were
visually inspected and contain only synthetic data.

All **18 generated files** rebuild byte for byte from the source included in the
free ZIP. Linux and Windows produce identical candidate archives. The exact
packages, checks, build metadata, source rebuild and CI results are retained in
[the directory verification record](wordpress-directory-verification.json).
The [full integration run](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37108889978)
also passes all three jobs, including 45 shared tests, both WooCommerce storage
modes, Shopify checks, the container and the native renderer deployment.

These changes ship in alpha.3; the alpha.2 downloads predate them.
Plugin Check is an automated review aid, not WordPress.org approval. The submitted
directory preview is awaiting human review. The product's production and
paid-service gates remain open.

<a id="unreleased-woocommerce-activity-view"></a>

## WooCommerce activity view

Alpha.3 adds **Fullbleed activity**, plus a notice on WooCommerce screens for
failed PDF workflows. The alpha.2 downloads predate this change. The following
activity-specific evidence was retained before the alpha.3 package release;
the current release record above identifies the published archives.

The view shows the latest result per order/email or customer-download workflow,
with failure filtering, specific recovery guidance, and native authorized order
links. Success clears the previous failure for that workflow. Preparation and
response readiness remain distinct from delivery. The view never sends email.

Real WordPress checks cover HPOS and legacy storage, actual attachment-hook
results, customer HTTP requests, permission denial, failure recovery, retention,
schema upgrades, deletion/trash, WooCommerce anonymization, deactivation and
uninstall. Simulating a missing activity table preserves real PDF preparation
and shows an incomplete-record warning. Unknown error codes cannot store private
extension error text in the activity table.

The [full Linux run](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37106090860)
passed all three jobs and **45 shared tests**. Each storage mode passed **60
email/activity checks** and **38 customer-download checks**. Every installed ZIP
entry matched the candidate archives, which also match the Windows build.

Chrome passed **12 checks** for the failure notice, activity navigation,
filtering, native HPOS order links, customer denial, readable mobile layout and
an actual browser-worker PDF download. Desktop, failure and mobile screenshots
were inspected, along with the downloaded one-page PDF. No page errors occurred.
The [desktop view](previews/woocommerce-activity.png) and
[mobile view](previews/woocommerce-activity-mobile.png) contain only synthetic data.

The native WordPress/MariaDB/HTTPS fixture passed **51 checks**, including failed
activity during a stopped renderer and replacement with a single prepared result
after recovery. The complete run and exact candidate archives are recorded in
[activity verification](activity-verification.json). The source used in CI is
`d8c2a61`; subsequent changes only retain evidence and strengthen the separately
executed browser assertions. No runtime or packaged source changed afterward.

The activity view is an attended status tool with bounded retention, not a
complete delivery ledger, push alert or automatic email retry. Production
delivery, merchant pilots, billing and update distribution remain open gates.

## Private renderer deployment

The [self-hosted deployment](../automation/DEPLOYMENT.md) now passes **39 native
Linux checks**. A fresh WordPress/PHP and MariaDB store installs every exact
alpha.2 ZIP entry, then calls the Compose renderer through Caddy over real TLS.
The fixture explicitly trusts a local certificate issuer and permits its private
Docker hostname. It does not disable certificate verification or substitute
WordPress HTTP responses.

The check rejects an untrusted issuer and an incorrect token, generates summary
and packing-slip PDFs, and compares both files with direct Node output. It
decodes captured WooCommerce MIME with Python's standard email parser and checks
the attachment name and complete PDF bytes. PHPMailer labels the extensionless
private temporary file `application/octet-stream`; its display name remains
`.pdf`. No email leaves the fixture. Private attachment files disappear after
the request, a stopped renderer preserves the original mail, recovery clears the
failure, and credential rotation rejects the previous token.

The actual container enforces its unprivileged user, read-only application files,
private credential-hash mount, resource limits and isolated renderer network.
Logs contain neither raw tokens nor the synthetic order fields. Both delivered
PDFs were visually inspected; each has one page and zero reported missing glyphs.
The packing-slip PDF and engine PNG also reproduce byte for byte on Windows.

All **45 shared tests** and all three jobs in the
[Linux run](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37103581003)
passed at source `061f28b`. The [retained deployment record](renderer-deployment-verification.json)
includes exact source, image and PDF hashes, the five operational phases and
decoded MIME metadata. Neither distributed WordPress ZIP changed in this work.

This verifies the native transport and deployment components with synthetic
data. Public DNS/ACME issuance, a merchant's host, production email delivery,
continuous operator response, backup restoration and paid lifecycle validation
remain separate launch requirements. The earlier mocked HPOS/legacy checks
below retain their original scope.

## Earlier product and operational evidence

The following checks were retained for the alpha.1 baseline on October 2–3, 2026.
They describe the original observed runs; their archive hashes are not alpha.2
hashes. No merchant store was changed and no customer PDF was retained.

### Executed checks

| Surface | Result | Retained evidence |
| --- | --- | --- |
| Node renderer, Shopify adapter/access/forms, browser-worker runtime, admin workflows and monitoring client | 43 tests passed | `output/node-tests.log` |
| WordPress/WooCommerce, free plugin with legacy storage | 46 HTTP checks passed; HPOS disabled in runtime | `output/wordpress/legacy-free-verification.json`, `legacy-free-runtime.json` |
| WordPress/WooCommerce, installed base and Pro ZIPs with HPOS | 46 HTTP checks passed; HPOS enabled in runtime | `output/wordpress/packaged-hpos-pro-verification.json`, `packaged-hpos-pro-runtime.json` |
| Six designed sample PDFs | Each one page, zero reported missing glyphs | `output/examples/verification.json` and matching PDFs/PNGs |
| Sixty-item long order summary and packing slip | Eight pages each; every SKU retained; text bounds inside pages | `output/pdf-text-verification.json`, `output/layout/` |
| Shopify application migrations, route types, TypeScript, lint, production build and request-handler tests | All checks passed; two readiness, four application, 11 Flow, 16 privacy, eight monitoring and 13 recovery tests passed | `output/shopify/verification.json` and matching test logs |
| Linux production container | 12 checks: unprivileged server, missing-volume and recovery-configuration refusal, private files, authentication, persistence, automatic backup/restart, CLI backup/erasure/restore, privacy monitor and constrained order burst | [CI record](ci-verification.json) |
| Railway staging | HTTPS/authentication checks, eight byte-identical commerce PDFs, enforced 0.5 CPU / 512 MiB limits and persistent branding/jobs through replacement | [Hosted evidence](staging-verification.json) |
| Hosted monitoring drill | GitHub healthy check, expected synthetic privacy-deadline failure and healthy recovery; private endpoint rejects missing/wrong tokens; public logs contain no credential or queue payload | [Monitoring evidence](monitoring-verification.json) |
| Hosted encrypted recovery and promotion | Three-part S3 backup; replay of erasure, completion and uninstall; restored service applies a later erasure before HTTP; templates and valid exports retained; sessions cleared and automation paused | [Recovery evidence](recovery-verification.json) |
| Automatic daily backups and freshness monitoring | Startup creates a verified snapshot; a synthetic stale snapshot fails external monitoring; maintenance catches up; a replacement process retains the same fresh snapshot | [Backup schedule evidence](backup-schedule-verification.json) |
| Privacy requests in real Chrome with synthetic Shopify sessions | 13 browser checks: encrypted snapshot download, exact large IDs, explicit completion, erasure, overdue notice and 390px layout | `output/browser/shopify-privacy-verification.json`, JSON download and screenshots |
| Shopify Flow extensions | CLI validates both native actions and output schemas | `output/shopify/flow-config-validation.json` |
| Actual Shopify Flow execution and browser downloads | 19 retained checks; both actions and the downstream step completed; downloaded PDFs match returned SHA-256 values; revoke and pause return HTTP 410 | `output/browser/shopify-flow-verification.json`, matching PDFs/PNGs |
| Automatic Shopify order trigger and staff destination | A new unpaid order triggered both actions and four native order-metafield updates; real Chrome downloads match preparation hashes; private field access and revoked links verified | [Order-trigger evidence](order-trigger-verification.json) |
| Operator notification delivery | Actual failed monitor notification observed through the API and browser inbox; its link opened the exact run; restored empty staging passed the recovery monitor before stopping | [Alert evidence](alert-verification.json) |
| Shopify service burst under staging ceilings | 24 jobs across four stores, one preparation each, 24 matching downloads; 0.5 CPU / 512 MiB, 709 successful readiness probes and no OOM events | [Capacity evidence](capacity-verification.json), [scope and reproduction](../shopify/CAPACITY.md) |
| Visual and source template editing in real Chrome 154 | Free editor saves, previews, reloads and resets; Pro also downloads a two-PDF ZIP and fits a 390px viewport | `output/browser/*-verification.json`, PDFs and screenshots |
| Shopify real-browser editing and downloads | Summary/packing-slip downloads, visual edit, HTML/CSS save, actual preview, persisted template and reset passed | `output/browser/shopify-verification.json` |
| Custom template rendering | Summary and packing slip: one page, zero missing glyphs, deterministic output; embedded PNG verified | `output/templates/verification.json` |
| Pro automation with HPOS and legacy WooCommerce | 27 checks in each; actual queued-email handler and captured PHPMailer MIME contain the exact rendered PDF; no email sent | `output/automation/woocommerce-*.json`, PDFs and MIME |
| Customer account downloads from freshly installed ZIPs | 35 checks in each of HPOS and legacy storage; real login, account pages, ownership, nonces, statuses/refunds, private downloads, cooldown and outage recovery | `output/automation/customer-*.json` and matching PDFs |
| Customer portal in real Chrome 154 | 12 checks: desktop/mobile account actions, native PDF download, merchant enable/disable and staff browser-worker parity | `output/browser/wordpress-customer-verification.json`, PDF and screenshots |
| Automation settings over HTTP | 12 permission, nonce, separate customer opt-in, consent withdrawal, secret handling and disconnect checks passed | `output/automation/settings-http.json` |
| Dependency audits | Root and Shopify production dependencies: zero findings. Shopify development tree: 11 affected dependency entries for one unpatched `braces` advisory | `output/npm-audit.json`, `output/shopify/npm-audit.json`, `output/shopify/npm-audit-production.json` |
| Shopify installation and test fixture | Installed offline `read_orders` session; verified development-store identity; synthetic draft completed unpaid | `output/shopify/installed-store/verification.json`, `output/shopify/test-store-after.json` |
| Live Shopify API to Fullbleed renderer | All six document/design variants rendered; one page each, zero missing glyphs | `output/shopify/installed-store/verification.json` and matching PDFs/PNGs |

The tested store ran WordPress 7.1.2, WooCommerce 11.1.2 and PHP 8.3.33.

The October 2 audit refresh reports [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
through the optional GraphQL code-generation development tools. No patched
`braces` version is published at this check. Its patterns here are repository
configuration, not merchant input. The production dependency audit is clear;
the runtime image removes development dependencies. The hosted recovery probe
also confirmed that `braces` cannot resolve in the deployed image. Keep this development-tool
finding visible until an upstream fix or suitable replacement is verified.
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
stopped. A later attended failure/recovery drill verified that the alert reached
the operator's GitHub inbox and linked to the exact failed run. Email receipt,
human acknowledgement and detection of missed checks were not verified.
See [monitoring operation](../shopify/MONITORING.md).

Recovery tests authenticate multipart SQLite snapshots and replay independent
erasure instructions. They cover failed database commits, unavailable storage,
wrong keys/datasets, damaged ciphertext, expired backups, damaged encrypted
exports, deduplication and retention. The hosted drill exercised real private S3
storage and signed HTTPS erasure/uninstall webhooks, then promoted the verified
restored database into a replacement service. A later erasure was applied at
startup before HTTP opened. Merchant sessions were cleared, automation paused,
old links revoked, and valid retained templates/exports verified. All fixtures
were synthetic. Daily creation and external freshness monitoring now pass an
attended hosted drill. Time-controlled tests cover the 24-hour schedule boundary,
longer downtime, interrupted uploads and private temporary snapshot cleanup.
The hosted stale condition used a deliberately backdated synthetic snapshot;
it was not a day-long availability test. GitHub inbox delivery is verified in
the [separate alert drill](alert-verification.json). Independent key recovery,
continuous operator coverage and missed-check detection remain operational
launch gates. See [recovery operation](../shopify/RECOVERY.md).

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
serving merchants. Billing, full hosted installation and Flow verification, continuous operator coverage,
independent key recovery and merchant rollout remain separate gates. See
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
- Shopify webhook monitoring, continuous operator coverage, missed-check detection, independent key recovery and secure support-delivery setup
  remain required. A real automatic new-order trigger now prepares both PDFs and
  saves links and expiry times in private Shopify order fields. Actual browser
  downloads and revocation passed. Repeat that complete workflow on the stable
  hosted origin with production configuration; the current check uses the
  development tunnel. Customer email delivery is not covered. Public
  distribution is selected; that is not App Store approval or publication.
- The Shopify toolkit's Polaris validator could not resolve its own
  `preact/jsx-runtime` and JSX types after three attempts, including a minimal
  component. The app's installed Polaris types pass TypeScript and production
  build checks; this does not substitute for real-browser QA.

The final [Linux CI run](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37096054789)
passed clean dependency installation, all 43 shared tests, plugin packaging,
28 WooCommerce email automation checks, 35 customer-download checks in each
order-storage mode, two readiness tests, four Shopify application tests, 11
Flow tests, 16 privacy tests, eight monitoring tests, 13 recovery tests and all 12 production-container checks. Linux
also verified restrictive attachment
file permissions. Both plugin archives are byte-identical to the Windows packages
installed for browser checks. Both customer-summary PDFs and the Flow fixture
PDF are identical across both operating systems. The retained [CI record](ci-verification.json)
identifies the checked source commit, archive hashes and individual automation
results. No production merchant credentials were supplied to CI.

The constrained container workload additionally prepared 24 jobs across four
synthetic stores and downloaded every PDF with identical bytes. The six document
cases match Windows output, including the 250-item order. This is a finite
service workload with synthetic order access and polling, not a production
Shopify throughput claim. See [capacity scope and results](../shopify/CAPACITY.md).

Spending remains recorded separately in [launch-budget.json](launch-budget.json).
