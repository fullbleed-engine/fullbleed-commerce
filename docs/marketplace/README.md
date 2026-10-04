# Shopify listing assets

These assets belong to the **unsubmitted Fullbleed Commerce development
preview**. They do not establish marketplace approval, a production launch,
or production merchant usage.

- [App icon](app-icon.png): 1200 × 1200 PNG, rendered from the original
  [SVG](app-icon.svg). Square background, no baked-in rounded corners, no text
  or Shopify marks.
- [Feature image](feature.png): 1600 × 900 PNG, rendered from
  [the HTML composition](feature.html). It shows actual Fullbleed-generated
  [Contrast order summary](../previews/contrast-order-summary.png) and
  [custom packing slip](../previews/custom-packing-slip.png) previews with
  fictional order data. It is promotional artwork, not a screenshot of an app
  screen.
- [Saved listing readback](listing-verification.json): icon, feature media,
  category tags, support contact, and permanent privacy URL verified after
  reloading the English draft. Asset URLs omit temporary signed query strings.
- [File verification](asset-verification.json): dimensions, sizes, and hashes
  for both final PNGs and their source files.

To reproduce the artwork, serve the repository on loopback (for example,
`python -m http.server 9479 --bind 127.0.0.1`) and capture
`/docs/marketplace/app-icon.svg` at 1200 × 1200 and
`/docs/marketplace/feature.html` at 1600 × 900, device scale 1. Wait for all
images to decode. The retained render used Chrome on Windows and Arial for
the feature-image text. No remote fonts or image generation service is needed.

The public [privacy notice](https://docs.fullbleed.dev/commerce/privacy/) is
served by the documentation site, independently of app uptime. It was published
by [docs PR #31](https://github.com/fullbleed-engine/docs/pull/31) after the full
documentation workflow passed, then checked over HTTPS and in desktop/mobile
browser views. Its source describes the current preview, including hosting logs
and delayed cleanup while the service is stopped.

The new `commerce.fullbleed.dev` CNAME and ownership TXT are configured in
Squarespace. [Railway's readback](../marketplace-domain-verification.json)
confirms propagated DNS, verified ownership, a valid certificate, no pending
infrastructure changes, and zero active deployments. Existing main-site, docs,
and email records were preserved. The app still uses its previous staging
origin until an attended origin migration and install/Flow check is complete.

## Remaining work before submission

The English form currently reports two issues: at least three desktop
screenshots and a screencast URL. Capture distinct views of the real installed
app after the branded-origin migration, without browser chrome, private links,
or real customer data. The local plans fixture uses an HTTP origin and a stubbed
Admin shell; it is unsuitable for final screenshots or a Flow-enabled capture.
No screenshots from that attempt were uploaded.

The parent submission checklist and the [hosted launch requirements](../hosted-plans.md)
still apply: protected customer-data review, platform checks, continuous privacy
and recovery operations, independent key recovery, billing lifecycle checks,
capacity/cost measurements, and consenting merchant pilots. Completing listing
fields does not satisfy those gates. Staging compute remains off between
attended tests; no new hosting subscription was purchased.

Design references:
[Shopify visual design](https://shopify.dev/docs/apps/design/visual-design),
[listing best practices](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices),
and [distinct listing images](https://shopify.dev/changelog/posts/clearer-standards-for-app-listing-images).
