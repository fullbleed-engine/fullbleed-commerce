# Staging infrastructure

`railway.ts` owns only the separate Fullbleed Commerce staging project and
preserves existing secret values on Railway. It refuses another linked project.
Use the pinned Railway CLI installed in the operator's tool environment; the
application does not need an infrastructure SDK dependency.

Run `railway config plan --out target/staging-plan.json`, inspect the proposed
changes, then `railway config apply --plan target/staging-plan.json --yes`.
The plan must preserve the volume, all secret variables and unrelated resources.
Do not use `--include-variables`, `--show-values` or `--confirm-destructive` for
routine deployment. Inspect effective cgroup limits as well as configuration.

Application source deploys from GitHub. Infrastructure changes require their
own reviewed plan/apply; committing this file alone does not apply them.
See [deployment and budget controls](../shopify/DEPLOYMENT.md).
