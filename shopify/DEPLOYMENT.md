# Shopify staging deployment

The synthetic staging project is separate from the newly provisioned, offline
production project. Both currently use Railway's default environment label
`production`; use their exact project/environment IDs. The
[environment isolation record](../docs/environment-isolation.md) covers separate
volumes, buckets, keys, monitoring secrets and real credential-denial checks.
Production has no deploy source, public domain or Shopify credentials yet.
The configuration below continues to describe the attended staging service.

Build the repository-root Docker context with `shopify/app/Dockerfile`.
The image pins Node.js 26.10.0. Node 24.21.0 has an intermittent native rendering
failure; the [runtime investigation](../docs/native-diagnostics.md) retains that
evidence and the upstream V8 lead. Keep the selected runtime aligned with CI.
`.railway/railway.ts` selects that image, one US West replica, a required `/data`
volume, a 0.5 CPU / 512 MiB ceiling, and `/health` readiness. These are initial
staging limits, not a verified production capacity or monthly spending cap.
Keep the server awake for signed webhooks. SQLite requires one instance;
volume deployments have a short interruption while the mount changes hands.
The container refuses Railway startup without its declared `/data` volume.

Use Railway's current Infrastructure as Code plan/apply workflow. The first
deployment accepted the older JSON build configuration but did not enforce its
runtime ceilings; a subsequent redeploy lost that build selection. Service
settings and cgroup inspection exposed the discrepancy. The current definition
imports the actual service and volume, preserves secrets, and requires a reviewed
plan. Do not treat a schema-valid configuration as proof of running limits.
The imported definition omits platform defaults; confirm `ON_FAILURE` and
disabled sleeping in the live settings. The entrypoint enforces the mount guard
because the current IaC importer does not retain `requiredMountPath`.

## Runtime configuration

Provide secrets through the host's secret variables, never build arguments,
source files or logs. Set:

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and the stable
  `FULLBLEED_PRIVACY_KEY` described in [PRIVACY.md](PRIVACY.md).
- A separate `FULLBLEED_MONITOR_TOKEN` for the read-only operator probe,
  configured as described in [MONITORING.md](MONITORING.md).
- The independent bucket, stable dataset ID and separate recovery key in
  [RECOVERY.md](RECOVERY.md). Initialize the bucket before starting the app.
- `FULLBLEED_BACKUPS_ENABLED=true` for startup/hourly checks and verified daily
  snapshots. A disabled or missing setting keeps the private monitor unhealthy.
- `SHOPIFY_APP_URL=https://commerce.fullbleed.dev`, `SCOPES=read_orders`,
  `NODE_ENV=production`, `PORT=3000`, and
  `DATABASE_URL=file:/data/commerce.sqlite`.
- `RAILWAY_RUN_UID=0` for Railway's initially root-owned volume. The entrypoint
  prepares only `/data`, then drops to the `node` user before migrations and
  HTTP startup. Files are created with a private umask. Other Docker hosts can
  use the default unprivileged image user with a pre-owned volume.
- `RAILWAY_DOCKERFILE_PATH=shopify/app/Dockerfile` so source redeploys retain
  the container build selection.
- The Partner API credentials and plan identifiers in `app/.env.example`
  before paid workflow testing. The Partner organization ID differs from the
  Dev Dashboard ID. Missing billing configuration denies paid access.

Migrations and erasure-journal reconciliation run at startup, after mounting the volume. Do not move them into a
Railway pre-deploy command: the persistent volume is unavailable there.
Do not copy the development SQLite database or its sessions to staging.
Install the app through Shopify to obtain fresh authorized sessions.

`app/shopify.app.staging.toml` points this registered app at the stable staging
origin `https://commerce.fullbleed.dev`, callback `/auth/callback` and signed
webhook routes. Keep this origin identical to `SHOPIFY_APP_URL`; the Flow action
URLs are relative to it. Provision the custom domain and verify DNS/TLS before
changing the runtime or releasing the Shopify configuration. Validate and deploy
it explicitly with `--config staging`. Stop the development preview with
`app dev clean` when switching to a released version. Existing Flow workflows can retain **Draft**
action references: replace those nodes with the released Fullbleed actions,
reconnect their inputs/outputs and apply the workflow changes. A published app
version alone did not migrate the saved development workflow in our test.

Keep the machine clock synchronized on local and hosted environments. During
the real development-store test, the Windows Time service was stopped and the
clock lagged Shopify by about 12 seconds. Session tokens then failed their
not-before check and the embedded page showed "Handling response". Restore
operating-system time synchronization; do not disable token verification or
weaken its checks. The retained browser test waited until tokens became valid;
that temporary test adjustment is not an application fix or production setup.

The public `/privacy` route redirects to the permanent
[privacy notice](https://docs.fullbleed.dev/commerce/privacy/), which remains
available while staging compute is stopped. The redirect does not forward
request parameters and suppresses the referrer.

## Verification and operation

`node tools/check-shopify.mjs` verifies that the public health route returns
only a status, rejects empty/inaccessible databases, and requires application
tables. It does not report billing, renderer capacity or merchant readiness.

After building `fullbleed-commerce:check`, run
`node tools/check-container.mjs`. It exercises a fresh root-owned volume under
the staging resource limits, verifies private file ownership and the HTTP
server's unprivileged identity, and replaces the container while retaining
synthetic branding and a pending job. Its temporary volume/container are
removed on completion. Results are in `output/container/verification.json`.

On the hosted service, check HTTPS readiness, authenticated installation,
denied unauthenticated document/webhook requests, and persistence through a
replacement deployment. Verify an actual Flow order trigger and downstream
destination with synthetic data before enabling merchant workflows. Complete
the App Pricing lifecycle separately; a healthy server is not billing evidence.

The [hosted workflow check](../docs/hosted-workflow.md) covers a fresh authorized
installation, private $0 plan checkout, saved custom template, actual order
trigger, both Flow actions, four private order fields and browser downloads on
the stable origin with `NODE_ENV=production`. The session, brand, template and
prepared links survived a replacement deployment. This is synthetic staging
evidence, not approval to accept paying merchants.

Railway readiness is checked during deployment, not continuously. The
[GitHub monitoring workflow](MONITORING.md) checks availability, privacy
deadlines and backup freshness. Enable it for continuous operation and arrange
operator coverage and detection of missed checks before launch. GitHub inbox
notification delivery has passed the [attended drill](../docs/alert-verification.json);
verify any additional paging channel separately. It does not
replace signed webhook delivery monitoring or the private
`node scripts/privacy-status.mjs` diagnostic command.
Use the [encrypted backup and recovery commands](RECOVERY.md); keep both keys
separate from backups. Verify independent key recovery
before launch, and keep the public privacy description accurate.

The launch authorization is **$50 total**. Track project-attributed usage and
actual charges in [the budget](../docs/launch-budget.json). The existing Railway
workspace also hosts unrelated projects; do not change its shared spending
limit or stop those services. Keep staging compute stopped between attended
tests until a bounded ongoing allocation and monitoring are in place. A
stopped deployment does not remove its volume or stop storage charges.

Platform behavior checked October 2, 2026:
[Railway volumes](https://docs.railway.com/volumes),
[readiness checks](https://docs.railway.com/deployments/healthchecks), and
[Infrastructure as Code](https://docs.railway.com/infrastructure-as-code).
