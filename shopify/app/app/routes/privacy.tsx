import { redirect } from "react-router";

export function loader() {
  return redirect("https://docs.fullbleed.dev/commerce/privacy/", {
    status: 302,
    headers: { "Referrer-Policy": "no-referrer" },
  });
}
