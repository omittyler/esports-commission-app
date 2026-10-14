import { createCookieSessionStorage, redirect } from "react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import db from "../../db.server";
import { requireApprovedAffiliate } from "./profile";

export function portalConfigured() {
  return !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.PORTAL_SESSION_SECRET &&
    process.env.PORTAL_SESSION_SECRET.length >= 32
  );
}
export function authClient() {
  if (!portalConfigured())
    throw new Error("Partner sign-in is not configured yet");
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
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
export async function limitAuth(action: string, email: string) {
  const window = Math.floor(Date.now() / 900000);
  for (const [scope, max] of [
    [`global:${action}`, 200],
    [`${action}:${email}`, 5],
  ] as const) {
    const key = createHash("sha256")
      .update(`${process.env.PORTAL_SESSION_SECRET}:${scope}:${window}`)
      .digest("hex");
    const bucket = await db.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: 1, expiresAt: new Date((window + 1) * 900000) },
      update: { count: { increment: 1 } },
    });
    if (bucket.count > max)
      throw new Response("Too many attempts. Try again later.", {
        status: 429,
      });
  }
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
  // Revalidate against the managed provider on every request; never trust cookie claims.
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
