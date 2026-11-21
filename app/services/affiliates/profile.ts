export function emailAddress(value: unknown): string {
  if (typeof value !== "string") throw new Error("Email is required");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email address");
  return email;
}
function field(form: FormData, name: string, max = 200) {
  const value = form.get(name);
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(
      `${name} is required and must be at most ${max} characters`,
    );
  return value.trim();
}
export function registrationProfile(form: FormData): {
  type: "organization" | "creator";
  firstName: string;
  lastName: string;
  email: string;
  displayName: string;
  organizationRole: string | null;
  paypalEmail: string;
} {
  const type = field(form, "type");
  if (type !== "organization" && type !== "creator")
    throw new Error("Select Organization or Creator");
  return {
    type,
    firstName: field(form, "firstName", 80),
    lastName: field(form, "lastName", 80),
    email: emailAddress(form.get("email")),
    displayName: field(
      form,
      type === "organization" ? "organizationName" : "creatorName",
    ),
    organizationRole:
      type === "organization" ? field(form, "organizationRole", 100) : null,
    paypalEmail: emailAddress(form.get("paypalEmail")),
  };
}
export function requireApprovedAffiliate(
  account: {
    status: string;
    organizationId: string | null;
    authSubject: string | null;
    verifiedAt: Date | null;
  } | null,
  subject: string,
) {
  if (
    !account ||
    account.status !== "approved" ||
    !account.organizationId ||
    !account.verifiedAt ||
    account.authSubject !== subject
  )
    throw new Response("Affiliate approval required", { status: 403 });
  return account.organizationId;
}

export function registrationChallenge(
  value: unknown,
): ReturnType<typeof registrationProfile> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid registration challenge");
  const input = value as Record<string, unknown>;
  const form = new FormData();
  for (const key of ["type", "firstName", "lastName", "email", "paypalEmail"]) {
    if (typeof input[key] === "string") form.set(key, input[key]);
  }
  if (typeof input.displayName === "string")
    form.set(
      input.type === "creator" ? "creatorName" : "organizationName",
      input.displayName,
    );
  if (typeof input.organizationRole === "string")
    form.set("organizationRole", input.organizationRole);
  return registrationProfile(form);
}
