import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { sameOrigin, sessionStore } from "../services/affiliates/auth.server";
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const store = sessionStore();
  return redirect("/portal/login", {
    headers: {
      "Set-Cookie": await store.destroySession(
        await store.getSession(request.headers.get("Cookie")),
      ),
    },
  });
}
