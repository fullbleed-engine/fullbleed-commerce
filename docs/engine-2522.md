# Commerce engine update

Commerce 0.1.6 uses the published `fullbleed@0.4.1` package and engine 2.5.22
for the free browser renderer and optional server renderer. Pro 0.1.2 is
unchanged. The plugin remains an evaluation preview; this update does not
establish marketplace approval, paid operation or a native crash fix.

## Merchant-visible correction

A custom care appendix numbers steps within separate Wash and Store sections.
With the prior engine, the labels are `1.1`, `1.2`, `2.3`: Store incorrectly
continues the previous section's step count. The updated engine produces
`1.1`, `1.2`, `2.1`. The fixture passes through Commerce's template validation,
escaped order-field substitution and real PDF renderer.

The checked-in [fixture](../fixtures/numbered-care-instructions.json) is also
pasted into the actual WordPress HTML/CSS editor during browser verification.
The downloaded preview must contain every instruction once with the correct
labels. After save and reload, the ordinary download must match that preview.
Those journeys continue to block all off-site requests.

## Existing templates

The frozen 0.1.1 saved-template HTML/CSS is unchanged. Independent pypdf checks
find the same text on the same four pages of its 32-item order. PDFium renders
three pages identically; the shipping amount on page 3 has a localized pixel
change. Both outputs were visually reviewed before recording the new engine's
PDF checksum. Its previous checksums remain in the fixture.

Saved templates remain authoritative, including their old pagination rules.
Corrected rendering can change PDF bytes or appearance; preview merchant
templates after updating. The ordinary pagination matrix checks all item
references, recorded amounts and closing content independently of the engine.

## Reproduce

Use the repository's Node 26.10.0 runtime requirement and browser dependencies:

```sh
npm ci --ignore-scripts
npm run setup:playground
npm run build
npm test
node tools/render-template-counters.mjs
python tools/check-template-counters.py
node tools/render-pagination.mjs
python tools/check-pagination.py
npm run pack
node tools/check-browser-workflows.mjs
```

The release archive retains exact package hashes, PDFs, previews and check
results. Installed upgrade checks begin with the published free 0.1.5 ZIP
and Pro 0.1.2, in both WooCommerce order-storage modes. Production hosting,
merchant delivery and paid lifecycle gates remain separate.
