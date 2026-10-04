# Merchant agreement and acceptance

A new Shopify installation must accept the current merchant agreement before
Fullbleed reads orders, prepares a Flow document or serves a private PDF link.
Privacy requests and access history remain available without acceptance or a
paid plan. Agreement acceptance never purchases a plan.

The [public version](https://docs.fullbleed.dev/commerce/agreements/2026-10-04/)
and the in-app page use the canonical text in
[`shopify/agreements`](../shopify/agreements/README.md). Published versions are
immutable. The server checks the exact version and SHA-256 and records only the
store, version, hash, time and acting staff ID from Shopify's verified session
token. A new version requires renewed acceptance. Uninstall and shop erasure
delete the receipt, including when an older backup is restored.

The [verification record](merchant-agreement-verification.json) retains the
tested commit, artifact hashes and CI evidence. Checks include 51 shared tests,
19 app-check groups, 10 agreement cases, 14 Flow cases, 24 recovery cases and 29
Chrome browser checks. The actual Shopify rehearsal covered installation,
privacy/access tools before acceptance, acceptance, a synthetic order PDF,
uninstall and restoration of the pre-uninstall backup. All eleven merchant-data
tables were empty after uninstall and again after recovery. The temporary
restore copy was removed and staging compute was stopped.

The standalone Shopify UI validator was attempted against Polaris 1.1 with
both TSX and rendered HTML. Its sandbox could not resolve the app imports or
JSX types. This is a retained validation limitation, not a passing provider
verdict. The application's pinned TypeScript build and real Polaris components
passed the local and hosted browser checks.

This agreement describes the synthetic development preview. Production
admission remains closed until separate environments, provider and transfer
arrangements, independent key recovery, and continuous operations are verified
and the production agreement is presented. The checks are not legal review or
Shopify approval. Free WooCommerce and the engine retain their own licenses.
