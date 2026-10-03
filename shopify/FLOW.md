# Shopify Flow document automation

Fullbleed adds **Create order summary link** and **Create packing slip link** to
Shopify Flow. Each uses the merchant's saved brand and template. It returns a
private browser download link, expiry time, job ID and SHA-256 of the verified
PDF. It does not email a customer, print a document or change order state.

This is a development preview. Hosting, privacy operations, paid
lifecycle testing and marketplace review remain launch work.

## Merchant workflow

1. Customize and preview a document in Template studio.
2. Open Fullbleed **Automations** and enable Flow automation.
3. In Shopify Flow, choose an order trigger, such as Order paid. Add the relevant
   Fullbleed action. The order comes from the trigger. The optional link lifetime
   is 1–72 hours; leaving it at 0 (or blank) uses 24 hours.
4. Use `downloadUrl` in a following step in your existing transactional service
   or internal workflow. Keep the link private. Test on a synthetic order before
   enabling delivery to customers.
5. Review Fullbleed activity for preparation state and download responses.

Start with [Prepare documents when an order arrives](recipes/order-documents.md):
both documents are prepared automatically and their private links and expiry
times appear on the Shopify order. The recipe uses native Flow metafield actions
and keeps Fullbleed's existing `read_orders` scope. It has passed a real automatic
order trigger and browser download check on the development store.

**Pause and revoke active links** stops unfinished jobs and invalidates active
links. Re-enabling accepts new workflow runs; it does not resurrect revoked links.
An individual job can also be revoked. **Retry preparation** retries a failed
document, but does not resume a Flow workflow that has already failed. Rerun that
workflow in Shopify Flow to continue its following steps.

## Reliability contract

- The official `authenticate.flow` implementation validates the signed request
  and installed offline session. The app checks the action handle, store identity,
  order GID, lifetime and current subscription before accepting a job.
- A database constraint binds one job to a store and Flow `action_run_id`.
  Replays with different input fail. Successful replays return the same link and
  expiry; they do not refresh its lifetime.
- Acceptance commits the job before returning `202`. Flow resends pending actions.
  A compare-and-set database lease allows only one worker to prepare a job.
  If the app process exits, Flow's next delivery can recover a lease after 90 seconds.
- Transient failures back off, with at most eight preparation attempts and a
  36-hour retry window. Invalid or unsupported orders require merchant action.
  Waiting for local render capacity does not spend a preparation attempt: the
  job remains durable and asks Flow to retry after five seconds. The same
  36-hour deadline still applies. Upstream failures after admission consume
  an attempt and retain exponential backoff.
  Jobs survive restarts; the app still requires a persistent database and a
  persistent Node process. It is not a serverless background-task implementation.
- `200` means the document was verified and its link is ready. It is not proof of
  email delivery. Download counts record completed server responses, not receipt
  or reading by a person. Downstream delivery remains the following step's job.

## Links and data

No order body or PDF is stored. The ledger retains order/action references, status,
template revision, keyed input fingerprints, PDF hashes, expiry and counts.
On download the app rechecks installation and subscription, reads the order,
and verifies that the input and resulting PDF match the original. Changes,
expiry, revocation, unsupported orders or lost access prevent downloading.

The link credential uses a purpose-specific HMAC derived from the app secret.
It is carried in the URL fragment, which browsers do not send to the server,
then in a POST authorization header. The landing page removes the fragment from
browser history, loads no external resources and sends no referrer. Server/proxy
operators must not log authorization headers or request bodies. Rotating the app
secret invalidates outstanding links. The original complete link is needed to
open a fresh tab or reload the page.

Private links are bearer credentials: anyone who receives the complete link can
download until it expires or is revoked. Never place them in public pages,
analytics events or marketing lists.

History older than 30 days is removed at app startup and hourly while the process
runs. Outages delay cleanup. Uninstall/shop redaction deletes the store's settings
and jobs. Customer redaction removes affected order references and hashes and
keeps an empty action-run tombstone until cleanup, preventing delayed retries from
recreating the document. Customer data requests capture retained metadata for
authenticated merchant export; see [Privacy requests](PRIVACY.md) for retention,
erasure and the remaining production operations requirements.

## Operations and verification

Run `node tools/check-shopify.mjs` from the repository root. It builds the actual
app and checks the request handler with real HMAC validation, isolated SQLite
storage and actual Fullbleed PDF bytes; Shopify network responses are synthetic.
It also checks competing database clients, process-lease recovery, backoff,
pause/uninstall races, forged and stale links, customer redaction and retention.

The CLI validates the Flow TOML and return schemas with
`shopify app config validate --json`. Keep `SHOPIFY_APP_URL` HTTPS and configured
from a trusted deployment value. Flow runtime URLs are relative to that origin.
No new Shopify access scopes are required beyond the app's existing `read_orders`.
Rendering limits currently apply per Node process; use one app process until a
shared capacity limiter and production database topology are validated.
The [order-burst check](CAPACITY.md) verifies that queued work survives repeated
capacity waits and completes under the current staging resource ceilings.

Platform references: [Flow action endpoints](https://shopify.dev/docs/apps/build/flow/actions/endpoints),
[action configuration](https://shopify.dev/docs/apps/build/flow/actions/reference),
and [return values](https://shopify.dev/docs/apps/build/flow/configure-complex-data-types).
