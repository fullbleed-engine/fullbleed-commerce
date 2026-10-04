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
  three actual app screenshots, screencast, category tags, support contact and
  permanent privacy URL verified after reloading the English draft. Asset URLs
  omit temporary signed query strings.
- [File verification](asset-verification.json): dimensions, sizes, and hashes
  for the artwork, screenshots and published video.

The installed app screenshots are distinct 1600 × 900 captures from the actual
synthetic Shopify store at the branded HTTPS origin:

1. [Automations](automations.png): two prepared document jobs and their activity.
2. [Template studio](template-studio.png): the saved visual template editor.
3. [HTML / CSS](html-css.png): editing the document source and print styles.

[Documents](documents.png) is an additional retained view. The first three are
uploaded to the listing; the fourth is not. They contain no browser chrome,
private download credentials or real customer data. These are app screenshots,
not artwork or local stub fixtures.

The [public walkthrough](https://docs.fullbleed.dev/commerce/shopify/) and
[direct MP4](https://docs.fullbleed.dev/assets/commerce/fullbleed-commerce-walkthrough.mp4)
show the actual installed app, saved template, manual retry of an existing Flow
workflow, document activity and pause. The 4 minute 12 second H.264 video has
English captions and no audio; idle intervals are removed and playback is 1.3
times the recorded speed. It uses an existing development-store test plan,
not a paid merchant checkout. The documentation page also supplies the two
verified synthetic PDFs. The [public-file verification](public-walkthrough-verification.json)
retains unauthenticated HTTPS responses, matching hashes, browser playback and
desktop/mobile layout checks.

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
records propagated DNS, verified ownership and a valid certificate. Existing
main-site, docs and email records were preserved. The
[attended origin migration](../branded-origin.md) then verified the new app URL,
OAuth callback, install, saved template, manual and Flow downloads, pause and
real uninstall. Staging returned to zero active deployments after the check.

## Remaining work before submission

The English listing is saved with its screenshots and public screencast. The
[readback](listing-verification.json) records zero form errors after reloading.
The parent dashboard confirms the listing was created and checked for common
issues; submission remains disabled. No local plans-fixture screenshots were
uploaded.

The parent submission checklist and the [hosted launch requirements](../hosted-plans.md)
still apply: protected customer-data review, platform checks, continuous privacy
and recovery operations, independent key recovery, billing lifecycle checks,
capacity/cost measurements, and consenting merchant pilots. Completing listing
fields does not satisfy those gates. Staging compute remains off between
attended tests; no new hosting subscription was purchased.

The [local App Store code review](../shopify-app-review.md) records the current
requirements, corrected Shopify entry pages and remaining browser/billing
checks. It does not complete the dashboard's final self-review attestation.

Design references:
[Shopify visual design](https://shopify.dev/docs/apps/design/visual-design),
[listing best practices](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices),
and [distinct listing images](https://shopify.dev/changelog/posts/clearer-standards-for-app-listing-images).
