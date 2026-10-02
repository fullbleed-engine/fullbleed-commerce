# Shopify application

Development preview of Fullbleed Commerce. Start with the repository root
[README](../../README.md) and [Shopify status](../README.md). This directory uses
the official React Router template at commit
`93348fe7dbd8e1a33eea69e2bbba1990d136b0da`; its MIT notice is preserved in
[LICENSE.md](LICENSE.md). Fullbleed additions and the combined app's document
designs are GPL-2.0-or-later; see the root [license map](../../LICENSE).

## Install and verify

Use Node.js 24.18+ (verified with 24.21.0). From the repository root:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm --prefix shopify/app ci --ignore-scripts
node tools/check-shopify.mjs
```

The app check uses synthetic credentials and a separate
`target/webhook-test.sqlite` database. It generates Prisma's client, applies
migrations, checks types/lint, builds the app and runs signed-webhook and
unauthenticated-request, template-isolation and concurrent-save tests. It also
checks Flow signatures, persistent deduplication, lease recovery, bounded retries,
link expiry/revocation, privacy cleanup and actual PDF downloads. It never uses
the installed store's session.
No Shopify account is needed for these checks.

For the maintainer's connected preview, copy `.env.example` to `.env`, keeping
`DATABASE_URL=file:dev.sqlite` and the exact authorized development-store domain.
Shopify CLI supplies the app credentials and tunnel URL:

```sh
cd shopify/app
npm run dev -- --store fullbleed-commerce-test.myshopify.com
```

Set `NODE_ENV=development` for that preview. The committed app configuration
identifies Fullbleed's development app. Contributors using their own Partner
organization must first run `npm run config:link` and select their own app and
development store. Never commit `.env`, `.shopify`, databases or access tokens.

For the connected store, the maintained synthetic-order check is:

```sh
node --env-file=.env tools/check-installed-store.mjs
```

It requires `NODE_ENV=development`, `FULLBLEED_DEV_STORE` set to the named store,
the installed app credentials, a valid `SHOPIFY_APP_URL`, and its session database.
It checks the store identity/plan, reads only orders tagged
`fullbleed-commerce-synthetic`, and generates six PDF/PNG variants. Its retained
record distinguishes data-access failure from completed PDF verification.

## Deployment preparation

Build the container **from the repository root**, since the app imports the
shared document and Pro design modules:

```sh
docker build -f shopify/app/Dockerfile -t fullbleed-commerce .
```

The Docker context excludes credentials, databases, generated output and local
dependencies. The runtime runs as the unprivileged `node` user, applies Prisma
migrations, and listens on port 3000. Supply the real app and Partner settings
from `.env.example` through the host's secret manager. Persist `/data` on an
encrypted volume owned by UID 1000; the database defaults to
`file:/data/commerce.sqlite`. Keep encrypted backups with a documented retention
policy and restrict operators' access to session tokens.

Run **one instance** with this SQLite configuration and process-local concurrency
limit. Multiple instances need shared durable storage and a shared render limit.
Set `NODE_ENV=production`; the development exception is disabled in that mode.
Configure HTTPS, request-size/time limits, session backup/recovery, and Partner
API rate handling on the selected host. Production hosting has not been chosen
or purchased. The CI container job tests startup with synthetic credentials;
passing it does not verify a hosting provider or live billing.

`shopify app deploy` publishes Shopify configuration/extensions; it does not host
the Node server. Set the production application URL and authentication redirect
URLs before publishing a production version. Keep the current tunnel available
for the maintainer's preview until then.

## Flow automation

The two Flow actions use the saved templates and the installed offline session.
Enable them in the app's **Automations** screen before testing. The development
preview requires public distribution, or a Plus development store for a custom
app. Run `shopify app dev` and select the actions marked Draft in Shopify Flow.
The [Flow guide](../FLOW.md) describes outputs, private links, retries and cleanup.

Flow redeliveries recover persisted jobs after a process restart. Keep a durable
database and a persistent Node process; do not deploy the asynchronous preparation
handler as a request-scoped serverless function. Rotating the app secret also
invalidates existing document links.

## Template studio

The Templates navigation opens a shared visual and HTML/CSS editor. Template
previews use authorized orders and the real PDF renderer. Shared frontend source
and bundled dependencies are explicitly allowed by the development Vite server;
private environment files and session databases are not added to that allowlist.
The editor uses local fonts copied by the root build or container build. See the
[template guide](../../docs/templates.md) for fields, saved revisions and limits.
