import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    return redirect("/app?" + url.searchParams.toString());
  }
  return redirect("/portal/login");
}
