# Privileged Commerce operations

Manual recovery and privacy diagnostics now require an operator, purpose and
private work reference. They persist and authenticate an encrypted start receipt
in the independent recovery bucket before database access, and a completion
receipt before returning success. A lost completion remains visible for review.
Startup reconciliation and scheduled maintenance have a separate service identity.

The [security operations procedure](../shopify/SECURITY-OPERATIONS.md) identifies
the confirmed operator, limits handling of customer data and defines incident
containment, evidence preservation, notification decisions and recovery. Console
sessions and exceptional direct database inspection use explicit begin/finish
commands. This supplements the existing [application access history](hosted-access.md).

On October 4, 2026, the candidate recorded in the
[verification record](operator-access-verification.json) passed 13 focused audit
tests, 51 shared tests, 18 Shopify verification groups, 14 production-container
checks and all nine pull-request CI jobs. The container also completed a
24-job synthetic PDF burst within 0.5 CPU and 512 MiB, with no HTTP health errors
and matching prepared/downloaded bytes.

An attended deployment then verified the exact runtime sources against the
private staging service. All ten merchant-data tables were empty. Real privacy,
backup and isolated restore commands completed with encrypted receipts; missing
operator context was rejected. The privileged inspection itself was recorded.
The app started and maintained backups without inheriting a human identity.

After removing the owned restore directory and stopping service compute, a
separate workstation process authenticated all five hosted manual-operation
completions and matched their ten encrypted objects in independent storage.
No incomplete records remained at that review. Retained evidence contains test
results and hashes, not copied customer data or raw hosted receipt payloads.

Receipts expire after 30 days through online recovery maintenance. They record
the configured actor, not an independently verified login. The credential holder
can forge or delete records. Console recording requires the documented procedure;
it does not automatically capture every provider event.

Production merchant admission remains closed. Separate production configuration,
processing terms, independent key recovery and continuous monitoring/retention
coverage remain launch work. This rehearsal is not an audit, certification or
Shopify approval. The service is stopped, with its private volume and recovery
bucket retained. The [launch budget](launch-budget.json) records the latest
metered usage separately from confirmed charges.
