# Merchant agreement versions

The versioned JavaScript file is the canonical text rendered inside the Shopify
app and exported for the public documentation site. `merchant-agreement.js`
hashes its full JSON content and requires that version and digest for acceptance.
Do not change a published version. Add a new dated file and update the import
when changing the agreement. Existing merchants must accept the new version
before protected document work resumes.

Generate the public page with:

```sh
node tools/export-merchant-agreement.mjs /path/to/docs/commerce/agreements/2026-10-04.md
```

Publish the versioned page before deploying an app that links to it. Verify the
public text against the canonical document. The public page does not itself
record acceptance. Only the authenticated in-app action can do that, using the
staff identity from Shopify's verified session token and a current installation.

Acceptance is independent of plan approval. Privacy requests and access history
remain available without accepting or buying a plan. The saved receipt is
minimal and replaced by later acceptance; shop erasure/uninstall removes it.
Recovery must replay that deletion just like other store records.

This version describes the actual synthetic preview and keeps production
admission closed. Production terms and admission must be updated together after
provider arrangements, transfers, separate environments, key recovery and
continuous operations are verified. This implementation is not legal review or
a claim of regulatory approval.

Drafting inputs checked October 4, 2026:

- [Shopify API terms, merchant agreement and privacy requirements](https://www.shopify.com/legal/api-terms)
- [Shopify protected customer data requirements](https://shopify.dev/docs/apps/launch/protected-customer-data)
- [ICO guidance on controller–processor contracts](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/)

The operator's identity and account controls came from direct confirmation;
service behavior and retention come from this repository's retained checks.
No certification or international-transfer arrangement is implied.
