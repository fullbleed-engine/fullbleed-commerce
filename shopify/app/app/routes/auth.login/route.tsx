import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { login } from "../../shopify.server";
export { default } from "../../components/shopify-entry";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Preserve Shopify's GET handoff; direct visitors open the app from admin.
  await login(request);
  return null;
};

// Old bookmarked forms return to the entry instructions without using their data.
export const action = async () => redirect("/auth/login", { status: 303 });
