# Availability, privacy and backup monitoring

The staging monitor checks HTTPS `/health`, then the authenticated
`/internal/monitor` endpoint. The private endpoint also verifies independent
recovery storage, its encrypted dataset marker and verified backup freshness. It needs no Shopify, billing, SSH or Railway account
credential. The endpoint is read-only and does not require a paid subscription.
It reports aggregate privacy queue counts and backup status/age, never shop/customer/request IDs,
exports, order data or document links. The CLI emits static operational messages
without those counts so its output can be retained in this public repository.

## Configure the existing workflow

1. Generate a separate random 32-byte token encoded as 64 hex characters. Set
   `FULLBLEED_MONITOR_TOKEN` in the hosted service and the `commerce-staging`
   GitHub environment secret. Do not reuse the privacy key or Shopify secret.
   Restrict that environment to the `main` branch. Rotate this token in both
   places together; it cannot decrypt exports or change the queue.
2. Set environment variable `FULLBLEED_MONITOR_URL` to the HTTPS origin plus
   `/internal/monitor`. Query parameters, fragments, credentials in URLs and
   redirects are rejected. The token is sent only to the private endpoint.
3. Run **Monitor Fullbleed staging** manually from Actions. It requires no package
   installation and times out after two minutes. Each HTTP request has a
   ten-second timeout; stale, oversized or cacheable responses fail the check.
4. While the service is intentionally stopped, keep repository variable
   `FULLBLEED_STAGING_MONITOR_ENABLED=false`. Before continuous operation, set
   it to `true`. The workflow requests runs at minutes 17 and 47 of each hour.
   Environment variables cannot replace this repository-level enable switch.

GitHub schedules run from the default branch and can be delayed or dropped under
load. Public repositories with no activity for 60 days have schedules disabled.
This is a staging check, not an availability SLA or independent dead-man alert.
A production operator must detect missed checks as well as failed checks.

## Respond to a failed check

- **Unavailable:** check service state, `/health`, the mounted database and the
  monitor credential and private recovery bucket. A missing privacy key or inaccessible database also fails
  closed. Do not put service logs or private exports in public issues.
- **Privacy deadline:** open the app's Privacy requests screen, identify the
  responsible store, and complete its response process. Requests due within 48
  hours, including overdue requests, keep the check red. Viewing/downloading an
  export does not fulfill a request; mark it handled only after responding.
- **Privacy key mismatch:** restore the correct existing privacy key. Do not
  generate a replacement or clear records to make the check green.
- **Backups disabled:** set `FULLBLEED_BACKUPS_ENABLED=true` on the service and
  verify its startup worker. Do not suppress this warning for continuous use.
- **Backup missing or unverified:** inspect the worker's safe error message and
  private recovery storage. Run `node scripts/recovery.mjs maintain` in the
  deployed environment, then require a fresh status. It creates a snapshot only
  when due; it never changes the independent erasure history to clear a warning.
- **Backup over 26 hours old:** check worker failures, storage capacity/access,
  resource limits and process uptime. Preserve the last good snapshot while
  repairing the failure, then verify a fresh snapshot and restore eligibility.
- **Invalid/stale response:** investigate endpoint version, proxy caching and
  clock synchronization. A malformed response must not look healthy.

A privacy warning returns HTTP 503 only on the private monitor route. It does
not change public deployment readiness or cause the service to restart. The
existing `node scripts/privacy-status.mjs` command remains available inside the
container for private operator diagnostics.

## Verify alert delivery before launch

Assign an operator who watches the repository and enables GitHub Actions failure
notifications in their account settings. Under **System → Actions**, enable
**On GitHub** and **Only notify for failed workflows**; preserve any existing
email preference. Watch this repository so its workflows are included. Complete
an attended failure and recovery drill and inspect the resulting notification
in the operator's inbox. A failed Actions run alone does not prove delivery.
Do not publish customer information in incident records.

On October 3, 2026, the signed-in `krflol` account enabled GitHub inbox alerts
while preserving email and failure-only settings, and subscribed to this
repository. An attended manual probe of intentionally stopped, empty staging
failed. Its notification appeared unread through the notifications API and in
the account's browser inbox; opening it led to the exact failed run. Staging was
then temporarily restored, its empty database and resource limits checked, and
the same monitor passed before compute was stopped again. See
[alert-delivery evidence](../docs/alert-verification.json).

This verifies delivery to the operator's GitHub inbox. The agent observed and
opened the alert; it does not establish human acknowledgement, email receipt,
mobile delivery or out-of-hours coverage. The drill used manual dispatch, not a
scheduled run. For continuous service, designate a person to monitor the tested
channel, verify any additional paging channel, and arrange independent detection
when checks stop arriving. Scheduling remains disabled while staging is stopped.

The backup probe authenticates the manifest and checks part presence. Creation
and restore verify full part contents; normal monitoring does not repeat a full
restore or prove independent key recovery. This probe also does not verify
signed webhook delivery, a new-order Flow trigger, email delivery, billing or
renderer capacity. Those remain separate
launch checks. Keep scheduling disabled and compute stopped between attended
staging tests under the [total launch budget](../docs/launch-budget.json).

Sources checked October 3, 2026: [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[Actions notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications),
[notification reasons and polling](https://docs.github.com/en/rest/activity/notifications),
and [environment branch policies](https://docs.github.com/en/rest/deployments/branch-policies).
