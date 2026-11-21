import {
  createHash,
  createHmac,
  randomInt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import db, { databaseContext } from "./database.server";
export function portalConfigured() {
  return !!(
    process.env.RESEND_API_KEY &&
    process.env.AUTH_FROM_EMAIL &&
    process.env.PORTAL_SESSION_SECRET &&
    process.env.PORTAL_SESSION_SECRET.length >= 32
  );
}
export function authClient() {
  if (!portalConfigured())
    throw new Error("Partner sign-in is not configured yet");
  return {
    auth: {
      signInWithOtp: sendCode,
      verifyOtp: verifyCode,
      getUser: sessionIdentity,
    },
  };
}
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const codeDigest = (id: string, email: string, code: string) =>
  createHmac("sha256", process.env.PORTAL_SESSION_SECRET!)
    .update(JSON.stringify([id, email, code]))
    .digest("hex");
async function sendCode(input: {
  email: string;
  options: { shouldCreateUser: boolean };
}) {
  const { binding } = databaseContext();
  const id = crypto.randomUUID(),
    code = randomInt(100000, 1000000).toString(),
    now = Date.now();
  // Return the same browser challenge for unknown login addresses; do not send
  // mail or disclose account existence. Registration may establish an identity.
  const account = await db.affiliateAccount.findUnique({
    where: { email: input.email },
  });
  if (!input.options.shouldCreateUser && !account?.verifiedAt)
    return { challengeId: id, error: null };
  const previous = await binding
    .prepare(
      'SELECT "createdAt" FROM "AuthChallenge" WHERE email=? ORDER BY "createdAt" DESC LIMIT 1',
    )
    .bind(input.email)
    .first<{ createdAt: number }>();
  if (previous && previous.createdAt > now - 60000)
    return {
      challengeId: id,
      error: new Error("Please wait before requesting another code"),
    };
  await binding
    .prepare(
      'INSERT INTO "AuthChallenge" (id,email,"codeHash","expiresAt","createdAt") VALUES (?,?,?,?,?)',
    )
    .bind(id, input.email, codeDigest(id, input.email, code), now + 600000, now)
    .run();
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `portal-code-${id}`,
      },
      body: JSON.stringify({
        from: process.env.AUTH_FROM_EMAIL,
        to: [input.email],
        subject: "Your Crafted sign-in code",
        text: `Your Crafted verification code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
      }),
    });
    if (!response.ok) throw new Error("Email delivery failed");
    return { challengeId: id, error: null };
  } catch {
    await binding
      .prepare('UPDATE "AuthChallenge" SET "consumedAt"=? WHERE id=?')
      .bind(Date.now(), id)
      .run();
    return {
      challengeId: id,
      error: new Error("Email delivery is unavailable"),
    };
  }
}
async function verifyCode(input: {
  email: string;
  token: string;
  type: "email";
  challengeId?: string;
}) {
  const invalid = {
    data: { session: null },
    error: new Error("Invalid or expired code"),
  };
  if (!input.challengeId || !/^\d{6}$/.test(input.token)) return invalid;
  const { binding } = databaseContext();
  // Attempts are incremented atomically even for an incorrect code. The CAS
  // below consumes a matching code once, before creating its opaque session.
  const row = (
    await binding
      .prepare(
        'UPDATE "AuthChallenge" SET attempts=attempts+1 WHERE id=? AND email=? AND "consumedAt" IS NULL AND "expiresAt">? AND attempts<5 RETURNING "codeHash"',
      )
      .bind(input.challengeId, input.email, Date.now())
      .all<{ codeHash: string }>()
  ).results[0];
  const actual = codeDigest(input.challengeId, input.email, input.token);
  if (
    !row ||
    row.codeHash.length !== actual.length ||
    !timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(actual))
  )
    return invalid;
  const token = randomBytes(32).toString("base64url"),
    now = Date.now();
  const account = await db.affiliateAccount.findUnique({
    where: { email: input.email },
  });
  const subject = account?.authSubject ?? crypto.randomUUID();
  const result = await binding.batch([
    binding
      .prepare(
        'INSERT INTO "AuthSession" ("tokenHash",subject,email,"verifiedAt","expiresAt") SELECT ?,?,?,?,? FROM "AuthChallenge" WHERE id=? AND email=? AND "consumedAt" IS NULL AND "expiresAt">? AND attempts<=5 AND "codeHash"=?',
      )
      .bind(
        digest(token),
        subject,
        input.email,
        now,
        now + 3600000,
        input.challengeId,
        input.email,
        now,
        actual,
      ),
    binding
      .prepare(
        'UPDATE "AuthChallenge" SET "consumedAt"=? WHERE id=? AND email=? AND "consumedAt" IS NULL AND "codeHash"=?',
      )
      .bind(now, input.challengeId, input.email, actual),
  ]);
  if (result[0].meta.changes !== 1) return invalid;
  return { data: { session: { access_token: token } }, error: null };
}
async function sessionIdentity(token: string) {
  const { binding } = databaseContext();
  const row =
    typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
      ? await binding
          .prepare(
            'SELECT subject,email,"verifiedAt" FROM "AuthSession" WHERE "tokenHash"=? AND "expiresAt">?',
          )
          .bind(digest(token), Date.now())
          .first<{ subject: string; email: string; verifiedAt: number }>()
      : null;
  return row
    ? {
        data: {
          user: {
            id: row.subject,
            email: row.email,
            email_confirmed_at: new Date(row.verifiedAt).toISOString(),
          },
        },
        error: null,
      }
    : { data: { user: null }, error: new Error("Session expired") };
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
    const bucket = await databaseContext()
      .binding.prepare(
        'INSERT INTO "RateLimitBucket" (key,count,"expiresAt") VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
      )
      .bind(key, (window + 1) * 900000)
      .first<{ count: number }>();
    if (!bucket || bucket.count > max)
      throw new Response("Too many attempts. Try again later.", {
        status: 429,
      });
  }
}

export async function revokeToken(token: string) {
  await databaseContext()
    .binding.prepare('DELETE FROM "AuthSession" WHERE "tokenHash"=?')
    .bind(digest(token))
    .run();
}
