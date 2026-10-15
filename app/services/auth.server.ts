import { authenticate } from "../shopify.server";

export function requireAdminOrigin(request: Request) {
  if (
    !process.env.SHOPIFY_APP_URL ||
    request.headers.get("origin") !==
      new URL(process.env.SHOPIFY_APP_URL).origin
  )
    throw new Response("Invalid request origin", { status: 403 });
}

/** This deployment belongs to exactly one configured shop. Every admin request checks it. */
export async function requireAdmin(request: Request) {
  const context = await authenticate.admin(request);
  if (
    !process.env.SHOPIFY_SHOP ||
    context.session.shop !== process.env.SHOPIFY_SHOP
  )
    throw new Response("Shop is not authorized", { status: 403 });
  return context;
}
