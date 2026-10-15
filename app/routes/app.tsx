import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { requireAdmin } from "../services/auth.server";
import { Shell } from "../components/AdminUI";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <NavMenu>
        <a href="/app" rel="home">
          Home
        </a>
        <a href="/app/organizations">Organizations</a>
        <a href="/app/affiliates">Affiliates</a>
        <a href="/app/payments">Commissions & payments</a>
        <a href="/app/programs">Programs</a>
        <a href="/app/ingestion">Order ingestion</a>
        <a href="/app/products">Product assignments</a>
      </NavMenu>
      <Shell>
        <Outlet />
      </Shell>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
