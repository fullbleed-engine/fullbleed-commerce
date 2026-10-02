export default function Privacy() {
  return <main style={{ maxWidth: 720, margin: '48px auto', padding: 24, fontFamily: 'sans-serif', lineHeight: 1.65 }}>
    <h1>Fullbleed Commerce privacy</h1>
    <p>Development preview. Updated October 2, 2026.</p>
    <p>Fullbleed Commerce reads the orders selected by authorized store staff to generate order summaries and packing slips. It processes order items, totals, and billing and shipping addresses in server memory for the requested PDF. It does not save customer orders or generated PDFs to its database.</p>
    <p>The app stores Shopify authorization sessions, seller branding and preferences, and the HTML, CSS and embedded logos you save in Template studio. Templates should use order fields rather than pasted customer details. These records are associated with your store and deleted when the app receives Shopify’s authenticated uninstall or shop-deletion notification.</p>
    <p>The app checks subscription status with Shopify. Shopify handles app plan selection and billing. Fullbleed does not collect payment-card details, sell customer data, or use it for advertising. A production hosting provider has not been selected and the app is not open to production merchants.</p>
    <p>Downloads remain on the receiving device and are managed by the merchant. The app receives Shopify privacy requests; because customer records are not retained, there is no saved customer order or PDF to export or erase.</p>
    <p>For access, correction, deletion or support, contact <a href="mailto:keenan@fullbleed.dev">keenan@fullbleed.dev</a>.</p>
  </main>;
}
