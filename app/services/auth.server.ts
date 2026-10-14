import { authenticate } from "../shopify.server";

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
