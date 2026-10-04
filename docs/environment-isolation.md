# Production environment isolation

Fullbleed Commerce now has separate Railway projects for synthetic staging and
the production service being prepared. Production has no deployment source,
public domain, Shopify credentials or running application. Its database has not
been initialized. Creating these resources does not open merchant admission.

The October 4, 2026 [verification record](environment-isolation-verification.json)
retains the resource identities, checks and evidence archive hash.

| Resource | Synthetic staging | Production preparation |
| --- | --- | --- |
| Railway project | `fullbleed-commerce-staging` | `fullbleed-commerce-production` |
| Project ID | `ee2c5784-260b-44d7-aff3-ef46714687bc` | `6337f5dc-6602-48a3-acba-0286271471ea` |
| Environment ID | `b3892972-504b-493b-8fc4-a6fb26b14d90` | `432435d8-c0d2-4ad5-80ae-0c1444e7e1d1` |
| Application volume | Existing synthetic `/data` volume | Newly provisioned 1,024 MB `/data` volume |
| Recovery storage | Existing private encrypted bucket | Separate private bucket and new dataset |
| Privacy/recovery keys and monitor token | Existing staging values | Independently generated values |
| GitHub environment | `commerce-staging` | `commerce-production`, restricted to branch `main` |
| Public application origin | `commerce.fullbleed.dev`, compute stopped | None |

Both Railway environments currently have the platform label `production`.
Select the exact project and environment IDs, not that label. The infrastructure
definition rejects unknown projects, missing environment IDs and crossed
staging/production pairs. Focused tests exercise those refusals and verify that
the unadmitted production configuration cannot connect a deploy source or
publish a domain.

## What was verified

The saved creation plan added only a service, volume and bucket to the new
project. Readback identified distinct volume IDs and zero active deployments in
both projects. Production has no generated or custom domain and cannot enable
GitHub autodeploy because no repository is connected. Both final infrastructure
plans report zero changes and no diagnostics; staging configuration is preserved.

The production privacy key, recovery key, monitoring token, dataset ID, bucket
name and bucket credentials differ from staging. Live secret readback matched
the generated values without putting them in source files or diagnostic output.
The keys also differ from each other. An encrypted copy uses Windows CurrentUser
DPAPI; that copy is tied to the operator's Windows account and is **not** evidence
of independent key recovery.

The unchanged application recovery adapter initialized and authenticated the
production bucket. Real S3 requests using staging credentials against production
returned HTTP 403; the reverse direction also returned HTTP 403. The production
marker rejected both the staging recovery key and staging dataset binding.
No staging snapshot or erasure history was copied. The staging marker and its
backup/erasure object listings remained unchanged. Initialization and these
operations have authenticated encrypted operator completion receipts under
`OPS-20261004-ENVIRONMENTS`.

The new GitHub environment contains only the production read-only monitoring
token. GitHub acknowledged that write and the branch restriction; no Railway or
Shopify account credential was added. There is no production monitor URL or
enabled production schedule, so this does not verify continuous monitoring.

The existing 51 shared tests and two focused infrastructure tests passed locally.
All five generated WordPress asset hashes match the preceding verified build.
The Railway SDK is a pinned development dependency; application source and the
Fullbleed engine are unchanged.

## Working with the definition

Use Node 26.10.0, Railway CLI 5.63.1 and the pinned `railway` 3.12.0 development
dependency installed by `npm ci --ignore-scripts`. Put both Node and the Railway
CLI on `PATH`: the SDK checks the CLI by executable name during evaluation.
An absolute CLI invocation alone is insufficient if the SDK cannot find it.

For production preparation, link an isolated checkout explicitly:

```sh
railway link --project 6337f5dc-6602-48a3-acba-0286271471ea \
  --environment 432435d8-c0d2-4ad5-80ae-0c1444e7e1d1 \
  --service b9f4dc6e-5435-4718-80d4-2c766435b11d
railway config plan --out production-plan.json
```

Review the target identities, resources, variables and any deletion before
applying a saved plan. Keep secrets in Railway using stdin and `--skip-deploys`;
the definition uses `preserve()` for existing secret values. Never export
decrypted variables into the repository or a plan artifact. A current no-change
plan does not require another apply. Do not duplicate staging into production,
copy its database or bucket, or point either service at the other environment's
keys or dataset.

The production settings declare one US West replica, a 0.5 CPU / 512 MiB ceiling,
the Dockerfile and `/health` readiness. These are configured limits, not a
production runtime or capacity measurement. The provider's legacy `numReplicas`
field is null for the undeployed service; its explicit region configuration
contains one replica. Keep using the full region configuration when reviewing it.

## Before merchant admission

Complete the provider/transfer arrangements and matching production agreement;
establish independently recoverable keys; assign separate production and
development Shopify app configurations and credentials; then verify the first
production deployment, runtime limits and database binding. Move the public
origin deliberately after that verification, leaving synthetic testing on its
own configuration.

Continuous retention, monitoring, missed-check detection, operator duty, bounded
hosting spend and Shopify review remain launch work. The production service is
offline while those requirements are unfinished. The [budget](launch-budget.json)
records both projects' metering separately from actual charges. Storage remains
metered while compute is stopped; no new hosting subscription was purchased.

Provider references: [Railway infrastructure](https://docs.railway.com/infrastructure-as-code),
[private buckets and isolated credentials](https://docs.railway.com/storage-buckets),
and [GitHub environment branch policies](https://docs.github.com/en/rest/deployments/branch-policies).
