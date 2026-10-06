# Run a private WooCommerce renderer

This deployment runs Fullbleed Commerce Pro's optional renderer on infrastructure
you control. WooCommerce sends an authorized order and its saved template over
HTTPS, receives the PDF, and attaches it to an existing email or returns it to
the signed-in customer. Staff do not need to leave a browser open.

Use this preview on staging first. The recipe does not purchase hosting, provide
a managed service, configure billing, or establish a production support promise.
The free WordPress plugin continues to work independently of this service.

## Prepare the host

Use a Linux Docker host with Docker Compose v2 and Node 24.18 or later for the
one-time credential helper. The container builds support amd64 and arm64;
the retained automated checks exercise Linux amd64. The renderer is capped at
512 MiB and half a CPU, with another 128 MiB for the HTTPS proxy. Leave capacity
for Docker and the host operating system, in addition to these limits.

Each PDF uses a fresh Node child process. The parent waits for its exit before
releasing the store's slot, including after failure, cancellation or the render
deadline. Keep child-process creation available and account for startup and
memory within the container's existing limit. This contains a renderer-process
failure; it does not establish production capacity or fix the open native-crash
investigation. The container workload must pass after renderer upgrades.

Choose a hostname such as `pdf.your-store.example`. Its public DNS must point to
this host, and ports 80 and 443 must reach it. Caddy uses those ports to obtain
and renew a public certificate. A reverse proxy already using these ports needs
its own routing configuration. Do not turn off WordPress certificate validation.

Use a reviewed source checkout and record its commit before deploying:

```sh
git clone https://github.com/fullbleed-engine/fullbleed-commerce.git
cd fullbleed-commerce
git rev-parse HEAD
```

Build dependencies, the Node base image and the proxy executable are pinned.
The proxy currently uses the checksum-verified Caddy 2.11.7 release binary on
the official image base, because 2.11.7 fixes a proxy regression in 2.11.6.
Review upstream updates and rerun the deployment checks before updating pins.

## Create the store connection

Create a new directory outside the checkout and outside every public web root:

```sh
umask 077
mkdir -p "$HOME/.config/fullbleed"
node automation/create-client.mjs "$HOME/.config/fullbleed/cedar-form-v1" cedar-form
```

The command prints file paths and the site ID. It does not print the token or
overwrite an existing directory. `wordpress-token.txt` holds a random 32-byte
credential and is owner-readable only on Linux. `clients.json` contains its
SHA-256 hash. The parent directory is private; the hash file is readable by the
unprivileged renderer when Docker mounts it. The raw token is never mounted in
the renderer container. Keep the token and WordPress database backups private.

Set deployment values in the operator's environment or a private environment
file outside the checkout. Keep the same Compose project name for later commands:

```sh
export FULLBLEED_CLIENTS_FILE="$HOME/.config/fullbleed/cedar-form-v1/clients.json"
export FULLBLEED_RENDERER_HOST="pdf.your-store.example"
export FULLBLEED_ACME_EMAIL="operator@your-store.example"
docker compose --project-name fullbleed-renderer -f automation/compose.yaml up -d --build --wait
```

Only the proxy publishes ports. The renderer runs as `node`, with a read-only
application directory, dropped Linux capabilities, a private temporary mount,
and an internal Docker network without external routing. It stores no orders or
PDFs. Proxy access logging is not enabled; avoid adding logs that record request
bodies, Authorization headers or customer fields. Public readiness is available
at `https://pdf.your-store.example/health`; it establishes process health, not
email delivery or a successful rendering test.

## Connect and enable a workflow

1. Install the free plugin and Pro on a staging WooCommerce store. Open
   **WooCommerce → Fullbleed automation**.
2. Enter the HTTPS origin, site ID `cedar-form`, and the token from
   `wordpress-token.txt`. Allow order processing by this renderer. Leave email
   attachments and customer downloads disabled, then save.
3. Test a synthetic order with **Test PDF connection**. Inspect its actual PDF
   and the saved template. This sends no customer email or order update.
4. Enable the specific email attachments or **Order summary PDF in My Account**.
   Exercise an actual order transition in staging with mail capture. Check that
   WooCommerce's background jobs run and that the document is attached correctly.
5. Monitor the renderer and the store's mail/queue health. An attachment marked
   prepared is not evidence of email delivery; the mail provider owns delivery.

The connection sends order document fields and the template to the chosen host.
Customer-account ownership is enforced in WordPress. The renderer token is a
store credential; do not give it to shoppers or embed it in front-end JavaScript.

### Check the complete staging workflow

Use fictional order data and a test mailbox. Keep a record of the plugin ZIPs,
renderer commit, scheduler configuration and received messages for your host:

1. Save a distinctive template and create a long order that spans several pages.
   Change it from pending to processing with attachments enabled. Confirm that
   WooCommerce's scheduled email job completes and the recipient's mailbox
   receives one email with the complete, readable PDF and the saved design.
2. Stop the staging renderer and trigger a second selected order email. Confirm
   that the original email arrives without the missing PDF, and Fullbleed activity
   shows the failure. If administrator alerts are enabled, let the site's normal
   scheduler run and check the administrator's mailbox for the failure summary.
3. Run the scheduler again and restart the site's PHP workers. Confirm that
   finished customer email jobs are not repeated and that the administrator
   summary respects its 24-hour attempt limit.
4. Restore the renderer and test a PDF. Recovery must not send another customer
   email by itself. Deliberately resend through WooCommerce once, verify the
   received attachment, and confirm that the relevant failure clears.
5. Check temporary attachment cleanup, the site's mail logs and the queue for
   stuck jobs. Repeat with the actual mail plugin/provider used by the store;
   plugins that postpone reading attachment files need their own check.

A successful mail handoff is not evidence of recipient delivery. Inspect the
receiving mailbox and provider's delivery or bounce records. The repository's
isolated SMTP check does not establish external-domain deliverability or replace
the merchant host's scheduler and mail acceptance check.

## Operate and recover

`docker compose --project-name fullbleed-renderer -f automation/compose.yaml ps`
shows process health. An external monitor must check the public HTTPS origin;
Docker health checks alone do not page an operator or restart an unhealthy
process. `restart: unless-stopped` restarts exited containers, not every failed
health check. Agree who will respond before enabling production automation.

When rendering fails, WooCommerce preserves the original order email and records
the attachment error. Customers see a retryable account-download error. Restore
the renderer, test the connection, and use WooCommerce's explicit resend action
when an attachment is still needed. Fullbleed does not send a second email
automatically. Do not repeatedly resend while the mail provider's state is unclear.

For planned maintenance, disable the relevant Fullbleed automation settings in
WordPress. Stop the service with `docker compose --project-name fullbleed-renderer
-f automation/compose.yaml stop`. Keep Caddy's named volumes: they hold its
certificate account and private keys, not customer PDFs. Do not delete them on
each update. Back up the connection configuration and certificate volumes with
restricted access, and test restoration on a separate staging host.

To rotate a token, leave automation disabled, create a new `cedar-form-v2`
directory with the same site ID, and point `FULLBLEED_CLIENTS_FILE` at its new
`clients.json`. Recreate the renderer so it loads the new hash:

```sh
docker compose --project-name fullbleed-renderer -f automation/compose.yaml up -d --no-deps --force-recreate --wait renderer
```

Save the new token in WordPress, test a PDF, then re-enable the workflows.
The previous token stops working after the renderer restarts with the new
configuration. For immediate revocation, stop the renderer until replacement
credentials are installed. Merely editing a file does not reload a running process.

For an update, retain the previous reviewed commit and image IDs, pause automation,
check out the next reviewed source and rebuild with the original `up` command.
Run the staging connection/email/customer checks before resuming. Rollback means
rebuilding the prior reviewed commit and rechecking it, while retaining the
connection and Caddy volumes. This is not an automatic plugin-update service.

## Limits and verification

Deploy one renderer process. Its per-store and process limits live in memory:
one render per store, two per process, and 120 attempts per store per hour.
They reset on restart and are not paid usage metering or a durable work queue.
The shared renderer also bounds request/PDF size and render duration. The store
must run its WooCommerce queue; this service does not receive or schedule orders.

To reproduce the deployment check on Linux with Docker, Node and Python 3:

```sh
npm ci --ignore-scripts
npm run build
npm run pack
node tools/check-renderer-deployment.mjs
```

It creates uniquely named, disposable Docker resources and removes them after
testing. The fixture uses native WordPress/PHP and MariaDB, actual plugin ZIPs,
a local TLS issuer, the Compose renderer and Caddy, and fictional orders.
It explicitly trusts that fixture issuer and permits only the private test
hostname; it does not disable TLS verification or substitute HTTP responses.
It checks an untrusted certificate, authenticated PDFs, matching Node output,
captured WooCommerce MIME, private attachment cleanup, outages, recovery and token
rotation. A separate phase installs a fixture-only SMTP configuration and sends
synthetic mail to a pinned Mailpit container on the private network. No SMTP or
mailbox port is published and no external relay is configured. Real order
transitions persist jobs in WooCommerce's Action Scheduler; a separate native
`wp-cron.php` process runs them. The check advances scheduled due times, verifies
received PDF bytes, exercises an outage and explicit recovery, and checks alert
cooldown across a WordPress container restart. Records and PDFs go to
`output/renderer-deployment/` and the matching CI artifact.

Public DNS/ACME issuance, a merchant's hosting/security policies, production mail
delivery, continuous operator response, and backup restoration remain separate
deployment checks. This recipe is not proof that the paid product has launched.
The [retained verification](../docs/renderer-deployment-verification.json) links
the passing native check and full Linux CI to their exact source and PDF hashes.

References: [Docker Compose services](https://docs.docker.com/reference/compose-file/services/),
[Caddy HTTPS](https://caddyserver.com/docs/automatic-https),
[Caddy 2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7),
and [WordPress HTTP certificate verification](https://developer.wordpress.org/reference/classes/wp_http/request/).
