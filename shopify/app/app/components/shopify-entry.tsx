import styles from "./shopify-entry.module.css";

export default function ShopifyEntry() {
  return (
    <main className={styles.index}>
      <div className={styles.content}>
        <p className={styles.eyebrow}>Fullbleed Commerce</p>
        <h1 className={styles.heading}>Open Fullbleed in Shopify</h1>
        <p className={styles.text}>
          Open Shopify admin, select Apps, then Fullbleed Commerce.
        </p>
        <a className={styles.button} href="https://admin.shopify.com/" target="_top">
          Open Shopify admin
        </a>
        <p className={styles.note}>Development preview for connected test stores.</p>
        <ul className={styles.list}>
          <li>
            <strong>Your documents</strong>. Design order summaries and packing slips with visual tools or HTML and CSS.
          </li>
          <li>
            <strong>Your workflow</strong>. Use Shopify Flow to prepare private document links when an order arrives.
          </li>
          <li>
            <strong>Privacy and support</strong>. Read how order content and activity data are handled in our <a href="/privacy">privacy notice</a>.
          </li>
        </ul>
      </div>
    </main>
  );
}
