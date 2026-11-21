import { createCookieSessionStorage, redirect } from "react-router";
import db from "../../db.server";
import { requireApprovedAffiliate } from "./profile";
import {
  portalConfigured,
  authClient,
  revokeToken,
} from "../../../cloudflare/email-auth.server";
export {
  portalConfigured,
  authClient,
  limitAuth,
} from "../../../cloudflare/email-auth.server";
export async function revokeCurrentSession(request: Request) {
  const session = await sessionStore().getSession(
    request.headers.get("Cookie"),
  );
  const token = session.get("accessToken");
  if (typeof token === "string") await revokeToken(token);
}
export function sessionStore() {
  if (
    !process.env.PORTAL_SESSION_SECRET ||
    process.env.PORTAL_SESSION_SECRET.length < 32
  )
    throw new Error("Partner session signing is not configured");
  return createCookieSessionStorage({
    cookie: {
      name: "__Host-affiliate",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
      secrets: [process.env.PORTAL_SESSION_SECRET],
    },
  });
}
export function sameOrigin(request: Request) {
  const expected = new URL(
    process.env.PORTAL_URL ||
      process.env.SHOPIFY_APP_URL ||
      "https://invalid.example",
  ).origin;
  if (request.headers.get("origin") !== expected)
    throw new Response("Invalid request origin", { status: 403 });
}
export async function signedInAccount(request: Request) {
  if (!portalConfigured())
    throw new Response("Partner sign-in is not configured yet", {
      status: 503,
    });
  const store = sessionStore();
  const session = await store.getSession(request.headers.get("Cookie"));
  const token = session.get("accessToken");
  if (typeof token !== "string") throw redirect("/portal/login");
  // Revalidate the hashed server session and current approval on every request.
  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data.user?.email_confirmed_at)
    throw redirect("/portal/login", {
      headers: { "Set-Cookie": await store.destroySession(session) },
    });
  const account = await db.affiliateAccount.findUnique({
    where: { authSubject: data.user.id },
  });
  if (!account || account.email !== data.user.email?.toLowerCase())
    throw new Response("Account identity mismatch", { status: 403 });
  return { account, subject: data.user.id };
}
export async function requirePartner(request: Request) {
  const { account, subject } = await signedInAccount(request);
  const organizationId = requireApprovedAffiliate(account, subject);
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  if (org.status !== "active")
    throw new Response("Affiliate access is inactive", { status: 403 });
  return { organizationId, displayName: account.displayName };
}
