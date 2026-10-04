# Prepare documents when an order arrives

Have a branded order summary and packing slip waiting on the Shopify order when
staff open it. Shopify Flow prepares the documents and saves their private links
and expiry times. Staff use the saved links to download; they do not generate
each PDF in Fullbleed.

This recipe is verified on the synthetic development store with **Order created**.
It is an internal staff workflow in the development preview. It does not send
customer email, collect payment, print automatically or mark orders fulfilled.

## Before enabling

Install Shopify Flow and the Fullbleed development app. Keep Fullbleed's server
running with persistent storage. In Template studio, save and preview the order
summary and packing slip. Order summaries use billing details; packing slips use
shipping details and omit prices. The current app rejects edited, cancelled or
refunded orders and unsupported characters.

Create these **order** definitions in **Settings → Metafields and metaobjects →
Orders → Add definition**. Keep each definition as **One**, and pin it so staff
can find it on the order.

| Name | Namespace and key | Type |
| --- | --- | --- |
| Fullbleed summary link | `custom.fullbleed_summary_link` | URL |
| Fullbleed summary expiry | `custom.fullbleed_summary_expiry` | Date and time |
| Fullbleed packing link | `custom.fullbleed_packing_link` | URL |
| Fullbleed packing expiry | `custom.fullbleed_packing_expiry` | Date and time |

Turn **Storefront API access off** and set **Customer Account API access to No
access** for all four. Leave cart copying and analytics filtering off. Do not add
the links to a theme, public page or analytics event. These are merchant-owned
fields so Shopify Flow can write them; staff and other authorized apps with order
access can read them. Fullbleed itself continues to request only `read_orders`.

## Connect the workflow

Create a workflow in Shopify Flow and leave it off during setup:

1. Choose **Order created** as the trigger.
2. Add Fullbleed **Create order summary link**, using the trigger's order.
3. Add Fullbleed **Create packing slip link**, using the same order.
4. Add four Shopify **Update order metafield** actions. Select each definition
   above. Use **Add variable** to insert the value from the relevant Fullbleed
   action according to this table. Keep the order set to the triggering order.

| Destination | Fullbleed action output |
| --- | --- |
| Fullbleed summary link | Create order summary link → `downloadUrl` |
| Fullbleed summary expiry | Create order summary link → `expiresAt` |
| Fullbleed packing link | Create packing slip link → `downloadUrl` |
| Fullbleed packing expiry | Create packing slip link → `expiresAt` |

Leave the link lifetime at **0** for the 24-hour default, or choose 1–72 hours.
Insert the complete returned URL, including its fragment. Do not shorten,
rebuild or strip it. No additional logging step is needed for this recipe.

When moving a development workflow to the released app, replace any Fullbleed
nodes labeled **Draft** with the released actions and reconnect their variables.
Publishing an app version does not replace saved Draft references in the workflow.

In Fullbleed **Automations**, enable Flow automation, then turn on the workflow.
Create one synthetic order in the development store. Confirm the run says
**Trigger event**, all six actions finish, and the four order fields contain
values. The verification workflow included one extra diagnostic log step;
that step is not required here.

## Staff use and recovery

Open the order's Metafields, copy the complete summary or packing link into a
browser, and choose **Download PDF**. Check the corresponding expiry first.
Anyone with a complete link can download until it expires or is revoked, so
share it only with its intended recipient.

If preparation fails, inspect Fullbleed activity and the Flow run. Correct the
order, template or access problem before retrying. A retry in Fullbleed prepares
the document but does not resume an already-failed Flow workflow; rerun that
workflow in Shopify Flow to execute its following field updates. A new deliberate
run may replace the saved links. A duplicate delivery of the same action run
does not extend its original expiry.

The four updates are separate Flow actions. A failed update can leave a partial
set of fields; confirm the complete run and both expiry fields before using
the documents. A changed order or template invalidates existing links instead
of silently returning changed content.

To stop, turn the Flow workflow off and use Fullbleed **Pause and revoke active
links**. Turning Flow off alone does not revoke links already issued. Pausing
Fullbleed makes the saved links return HTTP 410; it does not delete Shopify's
metafield values. Clear obsolete values using Shopify's normal order controls
when appropriate. Re-enabling does not revive revoked links.

## Verification and scope

On October 3, 2026 UTC, a new synthetic unpaid order triggered both actions
without manual replay. All four native metafield updates completed. Actual
browser downloads matched the preparation hashes, and saving the metafields did
not invalidate the documents. Both saved links stopped working after pausing.
Storefront and customer-account API access were independently read back as
`NONE`. See [retained evidence](../../docs/order-trigger-verification.json).

That first check used the development tunnel and development-store entitlement.
The later [hosted workflow check](../../docs/hosted-workflow.md) repeated the
complete recipe on the stable staging origin after a fresh installation and
private $0 plan checkout, with production subscription checks and a saved custom
template. Other triggers, actual paid merchants, continuous operation, external
email delivery, production capacity and marketplace approval remain separate
release gates.

Platform references: [Update order metafield](https://help.shopify.com/en/manual/shopify-flow/reference/actions/update-order-metafield),
[create custom metafield definitions](https://help.shopify.com/en/manual/custom-data/metafields/metafield-definitions/creating-custom-metafield-definitions),
and [metafield access](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/MetafieldAccess).
