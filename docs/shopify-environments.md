# Shopify app environments

Fullbleed Commerce uses two registered Shopify apps. The App Store identity is
reserved for production; local development and attended synthetic staging use
**Fullbleed Commerce Dev**. Both hosted services remain stopped. This separation
does not admit merchants or establish marketplace approval.

| Target | Configuration | Client ID | Origin |
| --- | --- | --- | --- |
| Local development | `shopify.app.development.toml` | `09e47bbd732e1cd77b17b99af2a64feb` | Shopify CLI tunnel |
| Synthetic staging | `shopify.app.staging.toml` | Same development app | `https://shopify-app-production-346e.up.railway.app` |
| Production preparation | `shopify.app.production.toml` | `91ba2420b9c9d87e00dab059b51eb005` | `https://commerce.fullbleed.dev`, routing move pending |

The base `shopify.app.toml` also identifies the development app. `npm run dev`
explicitly selects `development`; `npm run deploy` selects `staging`;
`npm run deploy:production` selects `production`. Do not rely on the CLI's cached
default configuration. Local development and hosted staging share one test app:
finish the local preview with `shopify app dev clean --config development` before
testing its released hosted version. Use a separate app for simultaneous tests.

Both apps use `read_orders`, Shopify API `2026-10`, the same signed webhook routes
and the existing two Flow extension handles and UIDs. Shopify documents these
UIDs as app-scoped; keeping them in source preserves each extension's mapping
across app instances. Do not regenerate the public app's extension identities.

## Initial separation verified October 4, 2026

- Shopify CLI validated the base, development, staging and production configs
  with zero issues.
- The development app released `isolated-development-20261004`, version
  `1154371584001`. Dashboard readback confirmed its clean display name, staging
  origin, callback, compliance webhooks and both Flow actions.
- The public app's complete version history matched the saved baseline. Its
  active release remains `branded-origin-aba1b19`, version `1153932984321`.
- Railway acknowledged and returned the intended per-service app credentials and
  URLs. The client IDs and secrets differ. All unrelated variables, including
  privacy/recovery keys, dataset identifiers and bucket credentials, matched
  their previous values. The writes explicitly skipped deployment.
- The public app's existing billing configuration moved to the offline
  production service. Staging's former app handle, Partner app ID, Partner token
  and allowed plans were cleared. Missing configuration denies paid access;
  staging cannot reuse the public app's subscription lookup.
- Both Railway services had zero active deployments before and after the change.
  No database was opened or copied. Operator receipts and a Windows CurrentUser
  DPAPI rollback copy were retained; no plaintext credentials entered source or
  verification output.
- The installed-store check refused the public app ID, an unrelated store and
  production mode before opening a database.

The [verification record](shopify-environment-verification.json) identifies the
retained evidence archive. Public distribution is selected for the development
app; its App Store listing has not been submitted.

The subsequent [development activation check](development-activation.md) verified
fresh installation, private $0 checkout, saved custom templates and a real
seven-action Flow run under the separate test identity. The current development
release is `development-flow-20261004`, version `1154436071425`. Staging now has
its own Partner API credential and test plan. After the check, uninstall emptied
all eleven merchant-data tables and both hosted services were verified stopped.

The public app is
[430863056897](https://dev.shopify.com/dashboard/238701392/apps/430863056897);
the development app is
[431437676545](https://dev.shopify.com/dashboard/238701392/apps/431437676545).
App client IDs are public configuration identifiers, not credentials.

## Remaining activation work

The custom domain `commerce.fullbleed.dev` is still attached to the stopped
staging service. Production has no domain or deploy source. Move and verify that
route deliberately when its backend is ready; setting `SHOPIFY_APP_URL` alone
does not route traffic or provision TLS.

Staging's customer-data selections, private test pricing and automatic workflow
are verified in the [activation record](development-activation-verification.json).
For the next attended check, install the development app freshly. Do not reuse
an offline session issued to the public app. Keep the workflow off and compute
stopped between attended checks.

Production still needs the provider/merchant agreement, first deployment,
runtime and database-binding verification, continuous retention and monitoring,
missed-check detection and a bounded ongoing budget before merchant admission.
The historical [hosted workflow evidence](hosted-workflow.md) belongs to the
previous shared identity. Use the new activation record for this installation.

The infrastructure definition preserves each service's assigned secrets. Obtain
app credentials from that app's own Shopify configuration and use the host's
secret interface with stdin; never copy session databases, export decrypted
variables into artifacts, or run verbose CLI logging during credential work.
The separate [key recovery procedure](independent-key-recovery.md) remains valid;
no privacy/recovery key or authenticated recovery binding changed.

Sources: [Shopify app configurations](https://shopify.dev/docs/apps/build/cli-for-apps/manage-app-config-files),
[app-scoped extension UIDs](https://shopify.dev/docs/apps/build/dev-dashboard/migrate-from-partners),
and [Railway domains](https://docs.railway.com/networking/domains).
