# Independent production key recovery

The manual `Recover production keys` workflow restores a missing production key
from the separate `commerce-production-recovery` GitHub environment. It runs on
a fresh GitHub-hosted runner and does not depend on the original Windows account
or a readable copy of the missing value in Railway. The normal
`commerce-production` environment continues to hold only its monitoring token.

The workflow checks an authenticated, encrypted control record in the production
recovery bucket. That record binds all nine saved values to the exact production
project, environment, service and dataset. It cannot be replaced by initialization.
Recovering only the encryption key is insufficient: the privacy key, monitoring
token and bucket credentials must also match the saved binding.

## Access and scope

Only manual dispatch on branch `main` in `fullbleed-engine/fullbleed-commerce` is
accepted. The GitHub environment must restrict deployment branches to `main`,
with no allowed tags. There is no pull-request trigger, schedule, reusable
workflow interface or arbitrary target URL, project or service input. Actions
are pinned to commit IDs. Dependencies are installed from the existing lockfile
with lifecycle scripts disabled before the recovery step receives secrets.

Each of the nine values is a separately named environment secret, alongside
`RAILWAY_RECOVERY_TOKEN`. The latter is a Railway **project token scoped to the
production environment**, not an account or workspace token. The script checks
that scope through Railway before reading or changing service variables.
The token itself has broader provider permissions than this script uses; the
script's fixed target and checks are not an API permission boundary.

GitHub now belongs to the privileged credential-recovery path. Repository
administrators and writers able to change trusted `main` code can potentially
use these secrets. Review repository membership before adding access or running
recovery; branch restrictions do not defend against a compromised administrator.
The operator has confirmed unique passwords and two-factor authentication for
the relevant accounts. Keep account recovery methods available independently of
the original workstation. This mechanism does not recover a lost GitHub account.

The GitHub runner reads only the recovery dataset marker, encrypted key binding
and its own encrypted operator receipts. It never opens the application database
or downloads customer backup objects. No secret files, database files, crash
reports or workflow artifacts are produced. Logs contain a fixed error message
or a small result with key **names**, counts and an audit ID, never key values.
This limited workflow does not remove the privileged capabilities of the stored
credentials or constitute a legal compliance finding.

## Provision and maintain the copy

An authorized operator must first compare the saved values with the actual
production environment, authenticate the existing recovery dataset, and create
the encrypted key binding with `initializeKeyBinding`. Record provisioning as a
privileged operation. Store values in GitHub secrets through stdin or its secret
API, without placing them in command arguments, source, logs or artifacts. Keep
the protected operator fallback until independent verification succeeds.

Run the workflow in `verify` mode after provisioning and before relying on the
copy. It authenticates every saved value and compares it with Railway's current
variables without writing host settings. This mode currently requires the
service to be offline as well. Local tests alone do not prove that GitHub has
the correct secrets; retain the actual run and provider readback evidence.

These are the existing unsealed service variables. Sealed or otherwise
unreadable values require a revised recovery procedure and runtime verification;
do not assume absence from the API means the value was lost. Before changing any
key or bucket credential, plan a replacement authenticated binding, update the
independent copy and test it. This workflow intentionally refuses rotation and
cannot overwrite a conflicting existing value. Never regenerate a lost privacy
or recovery key to clear an error.

## Recover missing values

1. Open a private `INC-YYYYMMDD-NNN` record. Review provider activity and stop
   production compute in an exclusive attended maintenance window. Confirm the
   intended dataset and that missing values, rather than an unreviewed rotation
   or sealed variables, are the cause. Keep merchant admission closed.
2. Open **Actions → Recover production keys → Run workflow** on `main`. Select
   `restore-missing` and supply the private incident reference. Do not include
   customer data in the reference or workflow inputs.
3. The workflow authenticates its control record and persists an operator start
   receipt before accessing host configuration. It refuses the wrong token,
   target, dataset, binding or any active deployment. Existing nonempty values
   must match exactly. It checks host state again immediately before writing.
4. Only missing or empty values are upserted, with `replace: false` and
   `skipDeploys: true`. A second read must match all saved values and show zero
   active deployments before the operator completion receipt is recorded.
5. Retain the run URL, commit, audit ID, changed key names and private provider
   readback. Rehearse the ordinary controlled-host database recovery, then
   verify application readiness, privacy processing, backups and monitoring
   before deliberately resuming the service.

The checks do not lock out a second person changing Railway concurrently.
Keep the maintenance window exclusive. A timeout or missing completion is an
uncertain outcome: inspect host state and receipts before retrying. There is no
automatic rollback that could delete a successfully restored key. A retry with
matching values performs no mutation. Conflicting values require investigation.

This mechanism covers missing credentials while the declared project and
recovery bucket remain available. It does not move the service to another
provider, replace a deleted project or restore a database in GitHub. The
[database recovery runbook](../shopify/RECOVERY.md) remains authoritative for
merchant data. Operator receipts use the existing 30-day retention policy and
record the configured GitHub actor; credential holders can forge or delete them.

Provider references: [GitHub environment secrets](https://docs.github.com/en/actions/reference/security/secrets),
[GitHub secrets and repository access](https://docs.github.com/en/code-security/reference/secret-security/secret-types),
and [Railway project-token scope](https://docs.railway.com/guides/lock-down-production-project).
