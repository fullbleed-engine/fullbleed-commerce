import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Your store, beautifully on paper.</h1>
        <p className={styles.text}>
          Designed order summaries and packing slips from Fullbleed. Development preview for connected test stores.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Original document designs</strong>. Studio, Contrast and Quiet bring considered typography to everyday orders.
          </li>
          <li>
            <strong>Your brand</strong>. Seller details, an accent color, A4 or US Letter and your closing note.
          </li>
          <li>
            <strong>Focused privacy</strong>. Customer orders and generated PDFs are not retained. <a href="/privacy">Privacy and support</a>.
          </li>
        </ul>
      </div>
    </div>
  );
}
