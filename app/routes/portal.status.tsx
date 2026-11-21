import type { LoaderFunctionArgs } from "react-router";
import { Form, data, redirect, useLoaderData } from "react-router";
import { signedInAccount } from "../services/affiliates/auth.server";
import { PortalLayout } from "../components/PortalLayout";
export const headers = () => ({
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
});
export async function loader({ request }: LoaderFunctionArgs) {
  const { account } = await signedInAccount(request);
  if (account.status === "approved") throw redirect("/portal/dashboard");
  return data(
    { name: account.displayName, status: account.status },
    { headers: headers() },
  );
}
export default function Status() {
  const { name, status } = useLoaderData<typeof loader>();
  return (
    <PortalLayout
      title={status === "pending" ? "Awaiting approval" : "Account access"}
    >
      <p>
        {name}:{" "}
        {status === "pending"
          ? "Your email is verified. Crafted will review your application before your dashboard becomes available."
          : `Your application is ${status}. Contact Crafted for help.`}
      </p>
      <Form method="post" action="/portal/logout">
        <button type="submit">Sign out</button>
      </Form>
    </PortalLayout>
  );
}
