import { serializable, textField } from "../admin.server";
import { registrationProfile } from "./profile";
import { percentageToBps } from "../commissions/domain";
import { amountToMinor } from "../money";

export async function registerVerifiedApplicant(
  profile: ReturnType<typeof registrationProfile>,
  subject: string,
) {
  return serializable(async (tx) => {
    const existing = await tx.affiliateAccount.findUnique({
      where: { email: profile.email },
    });
    if (existing?.authSubject && existing.authSubject !== subject)
      throw new Error("Identity does not match registration");
    if (existing?.verifiedAt) return existing;
    const verified = {
      ...profile,
      authSubject: subject,
      verifiedAt: new Date(),
    };
    return existing
      ? tx.affiliateAccount.update({
          where: { id: existing.id },
          data: verified,
        })
      : tx.affiliateAccount.create({ data: verified });
  });
}

export async function bindVerifiedIdentity(subject: string, email: string) {
  return serializable(async (tx) => {
    const account = await tx.affiliateAccount.findUniqueOrThrow({
      where: { email },
    });
    if (account.authSubject && account.authSubject !== subject)
      throw new Error("Identity does not match registration");
    if (!account.verifiedAt)
      throw new Error("Finish registration before signing in");
    return tx.affiliateAccount.update({
      where: { id: account.id },
      data: {
        authSubject: subject,
        verifiedAt: account.verifiedAt ?? new Date(),
      },
    });
  });
}
export async function reviewAffiliate(
  id: string,
  decision: "approved" | "rejected" | "suspended",
  actor: string,
) {
  return serializable(async (tx) => {
    const account = await tx.affiliateAccount.findUniqueOrThrow({
      where: { id },
    });
    let organizationId = account.organizationId;
    if (decision === "approved") {
      if (!account.verifiedAt || !account.authSubject)
        throw new Error(
          "The applicant must verify their email before approval",
        );
      if (!organizationId) {
        const org = await tx.organization.create({
          data: {
            name: account.displayName,
            type: account.type,
            slug: `${account.type}-${account.id}`,
            rates: { create: { rateBps: 0, effectiveFrom: new Date() } },
          },
        });
        organizationId = org.id;
      }
    }
    const result = await tx.affiliateAccount.update({
      where: { id },
      data: { status: decision, organizationId, reviewedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        actor,
        action: `affiliate.${decision}`,
        entityId: id,
        metadata: { previousStatus: account.status, organizationId },
      },
    });
    return result;
  });
}
export async function saveProgram(form: FormData, actor: string) {
  const name = textField(form, "name");
  const kind = textField(form, "kind");
  if (kind !== "percentage" && kind !== "fixed_item")
    throw new Error("Invalid commission type");
  const currency = process.env.SHOP_CURRENCY || "USD";
  const rateBps =
    kind === "percentage" ? percentageToBps(textField(form, "amount")) : 0;
  const fixedMinor =
    kind === "fixed_item"
      ? amountToMinor(textField(form, "amount"), currency)
      : null;
  const programId = form.get("programId");
  return serializable(async (tx) => {
    const program =
      typeof programId === "string" && programId
        ? await tx.commissionProgram.findUniqueOrThrow({
            where: { id: programId },
          })
        : await tx.commissionProgram.create({ data: { name } });
    const version = await tx.programVersion.create({
      data: {
        programId: program.id,
        label: name,
        kind,
        rateBps,
        fixedMinor,
        currency,
      },
    });
    if (program.name !== name)
      await tx.commissionProgram.update({
        where: { id: program.id },
        data: { name },
      });
    await tx.auditEvent.create({
      data: {
        actor,
        action: "program.version",
        entityId: program.id,
        metadata: {
          versionId: version.id,
          kind,
          rateBps,
          fixedMinor: fixedMinor?.toString() ?? null,
          currency,
        },
      },
    });
    return version;
  });
}
