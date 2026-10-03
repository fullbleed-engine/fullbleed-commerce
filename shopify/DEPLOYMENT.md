# Shopify staging deployment

Build the repository-root Docker context with `shopify/app/Dockerfile`.
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
- `SHOPIFY_APP_URL` to the service's HTTPS origin, `SCOPES=read_orders`,
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

Keep the machine clock synchronized on local and hosted environments. During
the real development-store test, the Windows Time service was stopped and the
clock lagged Shopify by about 12 seconds. Session tokens then failed their
not-before check and the embedded page showed "Handling response". Restore
operating-system time synchronization; do not disable token verification or
weaken its checks. The retained browser test waited until tokens became valid;
that temporary test adjustment is not an application fix or production setup.

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
