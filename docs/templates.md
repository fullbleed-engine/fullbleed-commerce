# Template studio

The WooCommerce and Shopify integrations share a locally bundled GrapesJS editor
and Fullbleed template renderer. No hosted editor, AI service, telemetry or new
dependency was added to the core PDF engine.

## Edit and preview

Choose a document type before editing. Move blocks in the visual canvas or Layers
panel, double-click text, and use the style panel for fonts, spacing, colors and
borders. Insert order fields using the field menu. Add a PNG/JPEG logo under
180 KB; its bytes are embedded in the template.

The HTML/CSS view accepts static HTML fragments, full documents and style tags.
The importer rejects unsupported elements or attributes with an error. It does
not silently run or remove scripts. Merchant CSS is preserved; visual changes
add overrides after it. HTML is parsed and normalized, so whitespace and entity
spelling may change. Saved templates contain HTML and CSS rather than the editor's
private project format; visual undo history lasts for the current editing session.

Preview PDF uses the first entered WooCommerce order ID or the Shopify preview
order. It does not save the template or retain the order/PDF on the server.
Save template applies it to future documents of that type, including Pro batches.
Load starter changes the editor draft. Use built-in design clears the saved custom
template. Export/import provides portable JSON backups. A stale revision is
rejected if another editor tab saved changes first.

## Fields and repeated blocks

Fields are text substitutions, not executable expressions or Liquid templates.
All order values are escaped once. Customer text containing HTML or another field
expression remains literal text.

| Fields | Meaning |
| --- | --- |
| `order.number`, `order.date`, `order.status`, `order.currency` | Platform order metadata |
| `seller.name`, `seller.address` | Seller branding and address lines |
| `customer.name`, `customer.address` | Billing recipient; summaries only |
| `shipping.name`, `shipping.address` | Shipping recipient |
| `document.title`, `document.footer` | Document type and current closing note |
| `item.name`, `item.sku`, `item.quantity`, `item.total` | Inside an items repeat; amount unavailable in packing slips |
| `total.label`, `total.amount` | Inside a totals repeat; summaries only |

Use `white-space: pre-line` for multiline addresses. Example:

```html
<h1>{{seller.name}}</h1>
<p>Order {{order.number}}</p>
<div style="white-space:pre-line">{{shipping.address}}</div>
<table>
  <thead><tr><th>Description</th><th>Qty</th></tr></thead>
  <tbody>
    <tr data-fb-repeat="items">
      <td>{{item.name}}<br><small>{{item.sku}}</small></td>
      <td>{{item.quantity}}</td>
    </tr>
  </tbody>
</table>
```

Repeat `data-fb-repeat="totals"` around a totals row in summaries. The platform's
emphasized total receives class `grand-total`. Nested repeats and fields in HTML
attributes are rejected. Keep customer details out of saved templates; use fields.

## Print styling

```css
@page { size: A4; margin: 16mm; }
body { font-family: Inter; font-size: 10pt; color: #203a32; }
h1 { font-family: 'DM Serif Display'; font-size: 36pt; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8pt; text-align: left; }
tr { break-inside: avoid; }
```

Bundled fonts are Inter, DM Serif Display and Bebas Neue. The canvas uses browser
layout, while PDFs use Fullbleed. Preview long representative orders before use.
Not all browser CSS is implemented by the PDF engine. Templates allow `@page`
and `@media`; remote URLs, imports, font URLs, JavaScript, SVG, forms, CSS escapes
and executable content are rejected. Use embedded PNG/JPEG images. Template HTML
and CSS together must be under 350 KB, with CSS under 65 KB. The expanded document
must fit the existing 500 KB input, 30-page and 30-second rendering limits.

## Storage and permissions

WooCommerce stores each template as a private, non-autoloaded site option. Reading
requires order-editing permission; saving requires `manage_woocommerce` plus a valid
REST nonce. The API returns templates as JSON, never executable admin HTML; shared
validation runs before both editor import and PDF expansion. Order reads retain
their separate per-order capability check. All assets and rendering stay local.

Shopify validates templates server-side and stores them by authenticated shop and
document type. Saves and previews require authenticated, entitled app access.
Uninstall and shop-redaction webhooks delete templates with the shop's other data.
Template requests have a 768 KB streaming body limit and previews share the normal
render concurrency limit. Neither platform saves order data or preview PDFs.

GrapesJS usage follows its [component](https://grapesjs.com/docs/modules/Components.html)
and [canvas APIs](https://grapesjs.com/docs/api/canvas.html). License text for the
editor and bundled parser dependencies ships with the plugin assets.
