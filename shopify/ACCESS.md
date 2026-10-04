# Document access history

The Shopify app records who requested protected document data, the operation,
its time and its outcome. **Access history** is authenticated through Shopify
and remains available without an active paid plan. This is an application
access record, not evidence that a recipient read or received a document.

## What is recorded

| Actor | Verified source | Operations |
| --- | --- | --- |
| Store staff | `sub` from the session token returned by Shopify's official authenticator | Recent orders, Template studio, PDF rendering and previews, automation activity, privacy requests/exports and access history |
| Shopify Flow | Run ID on the persisted job created by the authenticated Flow action | Document preparation |
| Private download link | Job ID after the existing signature, expiry and revocation checks | Document regeneration for download |
| Shopify privacy webhook | Validated HMAC and allowed topic | Capture of a customer-data export |

Staff attribution does not use the user who originally installed the app from
the offline session. A private link identifies the document capability, not
the person holding it. No additional Shopify permission is requested.

Records contain a random entry ID, store, actor type/identifier, fixed operation
name, start/finish timestamps and a bounded outcome. An order, automation job or
privacy-request reference is included when the operation targets that record.
Collection reads record the operation, not every returned order or customer.
The history therefore cannot reconstruct every customer seen in a list.

The allowlist excludes document contents, names, addresses, templates, IP
addresses, browser fingerprints, access tokens, full download links and raw
exceptions. It does not log invalid public-link probes or unauthenticated
requests. Requests rejected by entitlement or initial input checks can also
stop before reaching a protected read and have no audit entry. Platform
connection logs have their own scope and retention; see the
[public privacy notice](https://docs.fullbleed.dev/commerce/privacy/).

## Write and failure behavior

Before accessing the protected data, a short database transaction checks that
the installation still exists, verifies any stored job/request belongs to the
same shop, and writes `started`. A failed write prevents the operation.
The protected operation then runs outside that transaction. A second write
records `completed`, `denied` or `failed` before the wrapper returns its result.
These outcomes describe that operation, not necessarily the final HTTP response
or delivery to a device. Later stages of a Flow request can still fail.

If completion cannot be recorded, the result is withheld. An interrupted
request can remain `started`; this is not represented as a completed read.
If deletion removes an entry before its completion write, the result is
withheld and the entry is not recreated. Deletion cannot recall data already
returned or prevent every read that was already in progress.

The UI shows at most 50 records per page, newest first, with store-scoped cursor
validation. It excludes records older than 30 days even if cleanup was delayed.
Opening the history creates an access record visible on a subsequent refresh.
Responses prohibit caching.

## Retention, erasure and recovery

- Startup and hourly maintenance delete entries older than 30 days. Downtime
  can delay physical removal.
- Customer erasure deletes matching order references and associated privacy
  export access. Associations come from Shopify's order IDs and captured
  requests; the app does not retain an independent customer-to-order index.
- Completing a privacy request removes access entries referring to its export.
  Generic collection/capture entries contain no customer reference and expire
  through the normal 30-day policy.
- Uninstall and shop erasure remove all of the store's history in the existing
  transaction. In-flight completion cannot recreate deleted entries.
- Customer-data snapshots include retained access to the requested order IDs,
  without staff identifiers, private links or unrelated-store records. Each
  metadata collection is bounded to 50,000 rows and the complete export to
  16 MiB; exceeding a limit requires operator handling rather than truncation.
- Encrypted backup restoration migrates the schema, replays later erasure and
  completion instructions, then prunes expired history. Pre-audit backups are
  supported; they contain no earlier access history to reconstruct.

See [Privacy](PRIVACY.md) and [Recovery](RECOVERY.md) for response ownership,
encrypted snapshot retention and the required restore procedure.

## Operation and verification

Run app migrations before starting the updated server. Use the existing
readiness and [monitoring](MONITORING.md) checks, and investigate persistent
access-history errors as a database incident: the app intentionally withholds
protected operations when their record cannot be written. Do not disable the
audit wrapper to restore availability.

`node tools/check-shopify.mjs` exercises the actual production request handler,
SDK JWT/HMAC authentication and isolated SQLite. The dedicated audit tests
cover durable writes before reads, store isolation, verified staff attribution,
denial/failure, write outages, pagination, retention, customer exports,
concurrent deletion and backup erasure replay. Flow tests exercise signed
preparation, private-link download, manual PDF and preview attribution. Recovery
tests restore encrypted backups, including a database from before this schema.

`tools/serve-plans-fixture.mjs` with `tools/check-plans-browser.py` checks real
browser PDF generation, quota denial and access history at desktop/mobile
widths. The privacy fixture/check verifies JSON download and explicit
completion. Only the external Shopify APIs and admin shell are substituted;
the app routes, authentication, Polaris UI and PDF renderer are real.
Evidence is summarized in [the verification record](../docs/access-audit-verification.json).

## Launch limits

These checks use synthetic stores. The updated audit schema still requires an
attended hosted rollout and recovery check before operating for merchants.
The public notice must describe staff IDs and this retention before deployment.

This database history is not immutable or independently witnessed. It does not
record direct database reads, provider-console access, downloaded files or
operator access to backups. Infrastructure/operator controls, account access
reviews, key recovery, incident response and alert delivery remain separate
launch requirements. Do not answer Shopify's customer-data questionnaire as
complete based only on this feature or these tests.

References checked October 4, 2026:
[protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data),
[security practices](https://shopify.dev/docs/apps/build/security/following-security-best-practices),
[authenticated admin context](https://shopify.dev/docs/api/shopify-app-react-router/v3/guide-admin).
