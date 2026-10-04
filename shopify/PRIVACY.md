# Customer data requests

The app captures a merchant-downloadable export when Shopify sends
`customers/data_request`. The Privacy requests screen is authenticated with
Shopify session tokens and is independent of paid-plan access. A successful
webhook response means the snapshot is durable; it does not mean the customer
has received a response. The merchant downloads the JSON, responds through the
store's privacy process, and explicitly marks the request handled.

The snapshot contains the requested order references, retained automation job,
order-usage and order-specific access metadata at receipt, the request ID, and
the supplied customer ID/email. Access metadata omits staff identifiers. It does
not fetch more order data from Shopify or store PDFs, addresses, card details,
tokens, worker leases or download links. A request with no matching history
still produces a report explaining its scope. Already-expired history cannot be
reconstructed. Customer contact details supplied for the request are not used
for marketing or sent emails.

## Configuration and operation

1. Provision `FULLBLEED_PRIVACY_KEY` as a random 32-byte key encoded as 64 hex
   characters. Keep it stable across restarts and app-secret rotation; keep its
   backup separately from encrypted database backups. Do not commit or log it.
2. Run Prisma migrations before serving webhooks. The app encrypts snapshots
   with AES-256-GCM, random nonces, and store/request binding. Keyed identity
   hashes permit email-only redaction. The key identifier makes acceptance and
   erasure fail closed when pending records were created with another key.
3. Monitor signed webhook delivery failures and run `node scripts/privacy-status.mjs`
   inside the app container with its deployed environment. Output contains
   aggregate counts and the oldest receipt time, not customer identities.
   Exit 1 means a request is due within 48 hours (including overdue); exit 2
   means a key/configuration/database problem. Check the queue daily, assign an
   operator, and alert well before the 30-day deadline. The read-only
   [monitoring workflow](MONITORING.md) checks these conditions through a
   separate authenticated endpoint. Enable checks and verify notification
   delivery before production. The command alone is not an alert service.
4. Open Privacy requests to download and handle outstanding requests. Never
   mark a request handled merely because the export was prepared. Downloaded
   copies need the store's own retention and access controls.
5. Investigate every non-2xx privacy delivery. A missing installation returns
   503 rather than recreating identifiers after uninstall. Verify the store
   owner's identity and provide an accurate retained-data response through a
   secure support channel for late requests; do not send exports to an unverified
   email from a webhook. This support procedure needs staging verification.

Payloads are limited to 1 MiB and 10,000 requested order IDs; snapshots to 50,000
rows per metadata collection and 16 MiB of JSON. Identifiers preserve full decimal precision, including
numeric JSON values beyond JavaScript's safe integer range. Work runs in a
bounded transaction, with SQL parameter batching; failures do not acknowledge a
partial snapshot. Oversized or repeatedly failing requests require operator
handling within the response deadline, not silent truncation. Monitor the
five-second Shopify webhook budget under the production database/load.

## Erasure, retention and recovery

- Customer redaction clears matching exports by customer ID, email or requested
  order reference and revokes affected Flow jobs. This includes email-only
  requests with no order IDs when a captured request supplies the association.
  No customer-to-order index is otherwise retained; rely on Shopify's supplied
  order references for jobs not associated with an export.
- Completion immediately clears the encrypted export, identity hashes, key ID
  and order references. Redaction does the same and clears export activity.
  Minimal request receipts prevent duplicate webhook retries from recreating
  completed or erased snapshots. They are deleted 30 days after completion or
  erasure by startup/hourly cleanup. Revoked Flow run tombstones likewise last
  30 days after erasure. Server downtime delays cleanup.
- Outstanding exports remain available after the response deadline and are
  flagged overdue. Retention cleanup never silently treats an overdue request
  as fulfilled. Operators must resolve it promptly.
- Uninstall and shop redaction remove the store's requests, associations,
  sessions, preferences, templates, job history, order usage and access history
  in one transaction.
- [Access history](ACCESS.md) expires after 30 days. Customer redaction deletes
  matching order and associated privacy-export access references; completion
  removes references to that export. Generic collection-read entries contain no
  customer reference and expire through normal cleanup. Backup restoration
  reapplies these deletions before the restored database can be used.
- Order-usage references are retained through the current billing period and
  30 days afterward. Customer redaction deletes matching references and pending
  reservations, but preserves the period's aggregate successful-order count.
  In-flight work cannot recreate deleted usage receipts. Privacy exports include
  the requested orders' retained usage records and billing dates, without leases.
- Do not replace an active privacy key blindly. Existing snapshots require
  that key; a planned migration must re-encrypt snapshots and recompute lookup
  hashes before activating a replacement. Restore the original key to recover
  from an accidental configuration change.
- The [recovery tooling](RECOVERY.md) encrypts database backups and records
  durable erasure/completion instructions separately before acknowledging them.
  Restoration replays later erasures and revokes old active links. Verify
  scheduled backups, key recovery and the complete promotion procedure before
  production. A raw volume rollback must never bypass that procedure.
  HTTP erasure cannot recall a file already delivered to a browser or disk.

## Evidence and launch limits

`node tools/check-shopify.mjs` runs the production request handler against an
isolated SQLite database, including actual Shopify SDK HMAC/JWT authentication.
The privacy tests cover tenant isolation, numeric IDs, encrypted snapshot
integrity, retry deduplication, email-only/order-based erasure, explicit
completion, retention, pagination and bounded payloads. No billing or Admin API
request is permitted by those tests.

Lifecycle webhooks use Shopify's low-level HMAC validator over the bounded raw
body, with allowed topics and store validation, without loading or refreshing an
Admin session. The installed React Router SDK otherwise refreshes a nearly
expired offline token before dispatching the webhook; a revoked token made a
real uninstall return 500 before cleanup. Regression tests reproduce that
failure and cover expired and nearly expired tokens for uninstall, scope
updates and all three mandatory privacy topics. They verify zero network calls,
invalid signatures, body limits, duplicate deliveries and store isolation.
Durable recovery storage remains required before acknowledging erasure.

See the [hosted lifecycle evidence](../docs/hosted-workflow.md) and Shopify's
[webhook verification guidance](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).

`tools/serve-privacy-fixture.mjs` and `tools/check-privacy-browser.py` exercise the
built screen, download and completion flow in a real browser with synthetic
Shopify session tokens. The external Shopify admin/App Bridge shell is stubbed;
Polaris, browser hydration and server authentication are real. This does not
prove a live Shopify privacy-webhook subscription or production support delivery.

Production hosting, webhook monitoring, response ownership, secure late-request
delivery, backup erasure and a full App Store review remain launch gates.
No legal-compliance or marketplace-approval claim follows from these checks.

Source: [Shopify privacy webhook requirements](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance),
checked October 2, 2026. Shopify requires the three mandatory topics, signature
verification, fulfillment within 30 days, and data provision to the store owner.
