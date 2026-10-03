# Encrypted backups and erasure recovery

Recovery storage is a private object bucket independent of the SQLite volume.
Database snapshots and erasure instructions use AES-256-GCM with a separate
random key, unique nonces and dataset/object binding. The bucket never stores
generated PDFs. The database contains only random recovery receipts and a dataset
binding; customer exports remain encrypted with their existing privacy key.

## Configure before serving requests

Set the `FULLBLEED_RECOVERY_*` values in `app/.env.example` through the host's
secret variables. Use a random 32-byte hex recovery key and a stable UUID dataset
identifier. Keep the recovery key, privacy key and access credentials separately
from database backups, in the operator's protected secret storage. Do not rotate
either encryption key without a migration and a tested recovery procedure.

The staging bucket is `privacy-recovery`, in Railway's US West `sjc` region.
All objects are private and application-encrypted; Railway does not currently
provide bucket versioning, object locks or lifecycle rules. Never publish signed
backup URLs. The app's credential is scoped to this separate bucket and is not
available to the public GitHub monitoring workflow.

Use Node 24.18+ and run from `shopify/app`, with the deployed secret environment:

```sh
node scripts/recovery.mjs init
```

Run initialization once before deployment. Repeated initialization verifies the
existing encrypted marker and cannot replace it. A different key/dataset or a
database already bound to another dataset fails closed. Railway cannot use the
filesystem adapter; that adapter exists for isolated local/container rehearsals.

Container startup runs migrations, then `reconcile`, before opening HTTP. Missing
credentials, inaccessible storage or invalid journal objects stop startup. The
private monitor also checks storage access; a later outage does not cause public
readiness to restart the server. It prevents privacy operations from acknowledging
success without recording their recovery instruction.

## What a backup contains

```sh
node scripts/recovery.mjs backup
node scripts/recovery.mjs list
```

`DATABASE_URL` must identify an absolute SQLite path. The backup command first
reconciles any durable erasure whose original database commit failed. SQLite's
online backup API takes a consistent snapshot, including committed WAL content;
the application can continue using its database. A private temporary directory
holds the snapshot and is removed when the operation finishes.

Snapshots upload as separately authenticated 1 MiB parts. Every part is read back,
decrypted and compared before the encrypted manifest publishes last. The manifest
contains part and whole-file hashes and the verification time. An interrupted upload is
not a usable backup. The command bounds snapshot copying to 60 seconds, a database
to 512 MiB, and recovery reads to 100,000 journal objects / 64 MiB of encrypted
journal content. Exceeding a bound fails for operator review rather than silently
omitting records. Larger installations need measured capacity work.

Backups expire for restoration after seven days. Cleanup removes backup objects,
including interrupted uploads, after eight days. Erasure/completion instructions
remain for 35 days and are removed only after replay confirms their database
commit. Completed instruction receipts then expire too; the dataset binding stays.
Cleanup runs at startup and hourly while the server is online. Downtime delays
physical removal, but does not extend the seven-day restore limit.

## Automatic backups and freshness

Set `FULLBLEED_BACKUPS_ENABLED=true` for hosted operation. The single app replica
checks at startup and hourly, creating a snapshot when none is verified or the
latest snapshot is at least 24 hours old. It reads that time from independent
storage, so process replacement cannot reset the schedule. Manual backups remain
available; a concurrent manual operation can create an additional valid snapshot.

The worker runs as a separate unprivileged Node process with a ten-minute limit,
leaving the HTTP event loop available. A failed attempt logs a fixed operational
message and retries on the next hourly check. A hard-killed process can leave a
private temporary snapshot; the next maintenance/prune run removes owned copies
older than 24 hours while preserving active writers and unrelated files.

```sh
node scripts/recovery.mjs maintain
node scripts/recovery.mjs status
```

`maintain` runs the same retention and due-backup decision as the worker. `status`
is read-only and exits nonzero unless a verified snapshot is fresh. The private
HTTP monitor also fails for disabled scheduling, no verified backup, missing
parts, unreadable storage/manifest or a snapshot over 26 hours old. Its normal
probe authenticates the manifest and checks part presence; it does not download
and reauthenticate every part on each request. Full authentication runs during
creation and restore. Older manifests without verification timestamps remain
restorable but trigger a new verified backup.

Backups only run while compute is online. The first startup after downtime catches
up automatically. Staging remains stopped between attended tests to preserve the
launch budget. Continuous production use still requires an always-running service,
an enabled external monitor and a responsible operator with verified alert receipt.
Backup freshness does not replace periodic full restore/key-recovery drills.

## Why erasure survives rollback

Authenticated customer erasure, shop erasure/uninstall, and explicit merchant
completion first write an encrypted instruction to the independent bucket. The
erasure and its random receipt then commit in one SQLite transaction. The
instruction contains only the store/order references and keyed customer lookup
values required to repeat it; no raw customer email, address or export content.

A backup taken during that operation either contains both the erasure and its
receipt, or needs replay. If the original database commit fails after the bucket
write, startup/hourly reconciliation completes the durable intent. Missing or
invalid storage produces an error/retry, not a successful privacy receipt.
Replaying an already-applied event is harmless and does not recreate an export.

## Restore into quarantine

1. Stop the old app or block its incoming traffic before the final recovery
   rehearsal/promotion. Keep the independent bucket and its current contents.
   Never restore an old bucket alongside an old database: that would lose later
   erasure instructions.
2. Use the current app image in an operator/recovery process with its keys and
   bucket access. Choose an eligible backup from `list` and an absolute directory
   that does not exist. The command refuses an existing directory and never
   overwrites the source database:

   ```sh
   node scripts/recovery.mjs restore --backup BACKUP_ID --output /data/recovered-incident
   ```

3. Require a successful result and `recovery-ready.json`. The command verifies
   encryption tags, every part hash, the complete database hash, SQLite integrity
   and foreign keys. It replays the current erasure journal and checks that the
   privacy key can serve remaining outstanding requests. Failure removes its
   incomplete output; it does not publish a database for the app.
4. Inspect retained branding/templates and pending privacy work. Recovery clears
   authorization sessions, pauses every store's automation and revokes old active
   links/unfinished jobs. It compacts the restored database to remove deleted
   bytes from free pages. Existing completed/failed activity is retained subject
   to the normal history retention rules.
5. Point the stopped service's `DATABASE_URL` to the verified recovered file and
   start the app. Startup reapplies any later journal entries before HTTP opens.
   Verify readiness and private monitoring. Merchants reopen the app to obtain
   fresh authorization, review settings, re-enable automation, and run new Flow
   actions where needed. Recovery does not resend customer messages or replay old
   fulfillment jobs automatically.
6. Record the backup ID, verified source revision, hashes, elapsed time and
   checks in a private incident record. Dispose of temporary/quarantined copies
   after verification under the same access and retention controls. Downloaded
   merchant exports already outside the app cannot be recalled by recovery.

Raw Railway volume rollback is not a substitute for this workflow. Keep an app
using an unreviewed restored volume offline until it has been reconciled and
sanitized through the recovery tooling. Do not enable native snapshots as a
second, longer-retained copy without covering them in the same erasure and
retention procedure.

## Evidence and remaining operation work

`node tools/check-shopify.mjs` includes real SQLite/Prisma recovery tests:
multipart snapshots, preserved templates/exports, subsequent erasure/completion/
uninstall, commit rollback, failed storage, wrong keys/datasets, corrupt
ciphertext, expiry, replay deduplication and retention. Production handler tests
also verify that a storage outage cannot acknowledge erasure/completion and is
reported by private monitoring. The Linux container check exercises the CLI,
signed erasure and restoration under the staging resource limits.

The attended hosted drill used the private S3 bucket and the deployed CLI to
restore a three-part synthetic snapshot after customer erasure, completion and
uninstall. The replacement service then started on that recovered database and
applied an additional erasure received after the offline restore. Retained
templates and the outstanding export remained usable; authorization sessions
and active links stayed disabled. Readiness and private monitoring passed.
The [retained recovery evidence](../docs/recovery-verification.json) identifies
the exact source, deployments, hashes and cleanup.

Independent key recovery, operator alert receipt and a representative merchant
pilot remain launch work.
These checks do not claim legal compliance, a recovery-time SLA or marketplace
approval.

Sources checked October 2, 2026: [SQLite's online backup API](https://www.sqlite.org/backup.html),
[Node SQLite backup](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html),
[Node child processes](https://nodejs.org/download/release/latest-v24.x/docs/api/child_process.html),
[Railway bucket capabilities](https://docs.railway.com/storage-buckets), and
[Shopify privacy webhooks](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance).
