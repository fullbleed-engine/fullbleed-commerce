# Commerce security operations

Owner: **Keenan Finkelstein**, `keenan@fullbleed.dev`. Effective October 4, 2026.
The owner confirmed sole production access and unique passwords with two-factor
authentication for Shopify, GitHub, Railway and business email. Add another
operator only after assigning individual access, recording its purpose and
reviewing these procedures. Shared human accounts are prohibited.

These procedures cover the hosted Commerce integration. The current installation
is an attended development preview using synthetic orders; production merchant
admission remains closed. Continuous monitoring, independent key recovery and
the production processing agreement must be verified before that changes.

## Prevent unnecessary access and disclosure

Keep Shopify access limited to the order data needed for merchant-requested
documents. Use the supported application and aggregate diagnostic commands
before considering direct database access. Names, addresses and PDFs stay in
rendering memory; saved templates must use fields instead of pasted customer
details. The public [privacy notice](https://docs.fullbleed.dev/commerce/privacy/)
describes the retained metadata and its deletion periods.

Keep production and synthetic environments on separate datasets, credentials,
volumes and recovery namespaces. Do not copy production rows into tests, public
issues, chat, AI prompts or screenshots. Share no raw tokens, complete private
download links, database files or customer exports through those channels.
Use the private encrypted service volume for any necessary recovery quarantine;
do not restore production plaintext onto an unverified workstation.

Store service credentials in the provider's secret manager and keep independent
recovery keys in protected operator storage. Grant access only to the required
service/bucket. Review account membership and revoke unneeded credentials after
each access change or incident. Keep customer fields and secrets out of console
arguments and diagnostic errors. Follow the existing [recovery procedure](RECOVERY.md)
for key changes; replacing a key merely to clear an error destroys recoverability.

## Record privileged operations

Manual recovery and privacy-status commands require this context in the command
process environment. The reference identifies a private work record, never an
order, customer, secret or free-form explanation:

```sh
export FULLBLEED_OPERATOR_ID=keenan-finkelstein
export FULLBLEED_OPERATOR_REFERENCE=OPS-20261004-001
export FULLBLEED_OPERATOR_PURPOSE=maintenance
```

Use a new `OPS-YYYYMMDD-NNN`, `INC-YYYYMMDD-NNN` or `PRIV-YYYYMMDD-NNN` reference
for each maintenance, incident or privacy task. Purpose is one of `maintenance`,
`recovery`, `privacy`, `support` or `security`. Load the existing recovery secrets
through protected configuration, without printing them.

The CLI stores and reads back an encrypted start receipt in the independent
bucket before accessing the application database. It records completion before
returning a successful result. Initial dataset initialization creates only its
empty marker before recording the operation. Scheduled startup and backup work
has a separate service identity; it must not be attributed to a human.

For provider-console or exceptional direct database access, first run:

```sh
node scripts/operator-audit.mjs begin --surface railway
# Perform only the work described in the private reference.
node scripts/operator-audit.mjs finish --id AUDIT_ID --outcome completed
node scripts/operator-audit.mjs review
```

`shopify` and `github` are also supported surfaces. Use `failed` or `cancelled`
when appropriate. Record the affected environment, reason, approvals, actions
and result in the private work record. Begin before opening customer data and
close the session within 24 hours. If the initial receipt cannot be persisted,
stop ordinary access. In an active compromise, use the provider's controls to
isolate the service or revoke exposed access first, preserve its activity
record, then document that emergency exception as soon as safe.

Review every incomplete session before retrying its operation: a lost completion
receipt does not prove the operation failed. A stale session is evidence to
investigate, not permission to invent a successful finish. The review command
exits nonzero while an incomplete session remains. Review records after each
attended session and daily during production duty. Investigate unfamiliar
operators, purposes, references, unexpected service runs and missing receipts.

Receipts contain the configured actor, operation, reference, purpose, timestamps,
dataset and outcome. They contain no command arguments, SQL, customer/order
identifiers, paths, error text, exported data or PDF contents. The actor is the
configured identity; actual account authentication remains with the provider.
The storage/key holder can remove or forge receipts, so these records are not
immutable proof against that holder. Create-only writes prevent accidental
replacement; authenticated encryption detects modified or substituted objects.

Operator receipts expire after 30 days. The existing online recovery maintenance
prunes them; downtime delays physical deletion. `node scripts/operator-audit.mjs
prune` performs the same cleanup manually. Ordinary receipt retention must not
be silently extended by making convenience copies.

## Respond to an incident

Keenan is the incident owner and escalation contact. A suspected disclosure,
stolen credential, cross-store access or unexplained change to recovery/audit
records requires immediate containment when discovered. An overdue privacy
request, failed recovery or sustained outage needs prompt operational response.
A rejected unauthorized request alone does not establish a compromise; inspect
its scope and pattern before classifying it.

1. Open an `INC-...` record with the UTC discovery time, symptom, affected
   environment and current owner. Preserve relevant event IDs, deployment
   revisions, timestamps and hashes without copying customer payloads.
2. Isolate the affected service or pause automation. Revoke exposed credentials
   and active links where necessary. Preserve the independent recovery journal;
   do not roll it back alongside the database or clear warnings to resume service.
3. Establish what was accessed, which stores may be affected, how long the issue
   existed and whether access continues. Record what is known and what remains
   uncertain. Use the controlled access procedure for necessary inspection.
4. Notify Shopify through `security@shopify.com` for suspected compromise and
   determine the required merchant and regulatory notices promptly. Record the
   applicable contractual/legal deadlines, recipients, decisions and follow-up
   in the private incident record. Do not wait for a complete investigation to
   contain active exposure or provide the initial Shopify notice.
5. Correct the cause, rotate affected credentials and restore only through the
   verified quarantine workflow. Check privacy erasures, revoked links, account
   access, readiness, monitoring and document generation before resuming. Resume
   deliberately; do not automatically replay old messages or fulfillment work.
6. Record the cause, impact, remediation and evidence of recovery. Add a focused
   regression check or operational control for the failure that occurred. Review
   the procedure after an incident and before adding an operator or data purpose.

The [monitoring runbook](MONITORING.md) defines the tested alert channel and
remaining coverage work. A notification test does not establish continuous human
response. Assign production duty and verify missed-check detection before
admitting merchants; this document does not promise a response-time SLA.

These procedures follow Shopify's [customer-data requirements](https://shopify.dev/docs/apps/launch/protected-customer-data)
and [security guidance](https://shopify.dev/docs/apps/build/security/following-security-best-practices).
The [attended verification](../docs/operator-access.md) records the implemented
operator controls, hosted recovery rehearsal and independent storage readback.
They do not represent a third-party audit, certification or Shopify approval.
