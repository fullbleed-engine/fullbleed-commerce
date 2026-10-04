import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
export { default } from "../../components/shopify-entry";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};
