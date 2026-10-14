import { Prisma } from "@prisma/client";
import db from "../db.server";
import { percentageToBps } from "./commissions/domain";

export async function serializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable =
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2034", "P2002"].includes(error.code)) ||
        // PostgreSQL can report an exclusion conflict before a serialization
        // failure when concurrent collection snapshots insert the same target.
        (error instanceof Prisma.PrismaClientUnknownRequestError &&
          error.message.includes("23P01") &&
          error.message.includes("assignment_no_overlap"));
      if (!retryable || attempt >= 3) throw error;
    }
  }
}
export function textField(form: FormData, name: string, max = 200): string {
  const value = form.get(name);
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`Invalid ${name}`);
  return value.trim();
}
export function effectiveDate(form: FormData): Date {
  const value = textField(form, "effectiveFrom");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z$/.test(value))
    throw new Error("Use an ISO timestamp in UTC, ending in Z");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date < new Date())
    throw new Error("Effective date must be in the future");
  return date;
}
export async function createOrganization(form: FormData, actor: string) {
  const name = textField(form, "name");
  const slug = textField(form, "slug", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error("Slug must contain lowercase words separated by hyphens");
  const rateBps = percentageToBps(textField(form, "percentage"));
  return serializable(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name,
        slug,
        rates: { create: { rateBps, effectiveFrom: new Date() } },
      },
    });
    await tx.auditEvent.create({
      data: {
        actor,
        action: "organization.create",
        entityId: org.id,
        metadata: { name, slug, rateBps },
      },
    });
    return org;
  });
}
export async function updateOrganization(
  id: string,
  form: FormData,
  actor: string,
) {
  const intent = textField(form, "intent");
  return serializable(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id } });
    if (intent === "settings") {
      const name = textField(form, "name");
      const status = textField(form, "status");
      if (status !== "active" && status !== "inactive")
        throw new Error("Invalid status");
      await tx.organization.update({ where: { id }, data: { name, status } });
      await tx.auditEvent.create({
        data: {
          actor,
          action: "organization.update",
          entityId: id,
          metadata: {
            before: { name: org.name, status: org.status },
            after: { name, status },
          },
        },
      });
    } else if (intent === "rate") {
      const rateBps = percentageToBps(textField(form, "percentage"));
      const effectiveFrom = effectiveDate(form);
      const last = await tx.commissionRate.findFirst({
        where: { organizationId: id },
        orderBy: { effectiveFrom: "desc" },
      });
      if (last && effectiveFrom <= last.effectiveFrom)
        throw new Error("New rate must start after the latest scheduled rate");
      if (last)
        await tx.commissionRate.update({
          where: { id: last.id },
          data: { effectiveTo: effectiveFrom },
        });
      await tx.commissionRate.create({
        data: { organizationId: id, rateBps, effectiveFrom },
      });
      await tx.auditEvent.create({
        data: {
          actor,
          action: "rate.schedule",
          entityId: id,
          metadata: { rateBps, effectiveFrom: effectiveFrom.toISOString() },
        },
      });
    } else throw new Error("Unknown action");
  });
}
export async function assignProduct(
  input: {
    organizationId: string;
    productGid: string;
    variantGid: string | null;
    displayTitle: string;
    effectiveFrom: Date;
    programVersionId?: string | null;
  },
  actor: string,
) {
  return serializable(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
    });
    if (org.status !== "active")
      throw new Error("Activate this organization before assigning products");
    await validateProgramAssignment(
      tx,
      input.organizationId,
      input.programVersionId,
    );
    const last = await tx.productAssignment.findFirst({
      where: { productGid: input.productGid, variantGid: input.variantGid },
      orderBy: { effectiveFrom: "desc" },
    });
    if (last && input.effectiveFrom <= last.effectiveFrom)
      throw new Error(
        "Assignment must start after the latest scheduled assignment",
      );
    if (last && (!last.effectiveTo || last.effectiveTo > input.effectiveFrom))
      await tx.productAssignment.update({
        where: { id: last.id },
        data: { effectiveTo: input.effectiveFrom },
      });
    const assignment = await tx.productAssignment.create({ data: input });
    await tx.auditEvent.create({
      data: {
        actor,
        action: "assignment.create",
        entityId: assignment.id,
        metadata: {
          ...input,
          effectiveFrom: input.effectiveFrom.toISOString(),
          previousOrganizationId: last?.organizationId ?? null,
        },
      },
    });
    return assignment;
  });
}
export async function retireAssignment(id: string, actor: string) {
  return serializable(async (tx) => {
    const assignment = await tx.productAssignment.findUniqueOrThrow({
      where: { id },
    });
    const [{ now }] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
    if (assignment.effectiveFrom >= now)
      throw new Error("Future assignments cannot be retired before they begin");
    if (assignment.effectiveTo && assignment.effectiveTo <= now)
      throw new Error("Assignment has already ended");
    await tx.productAssignment.update({
      where: { id },
      data: { effectiveTo: now },
    });
    await tx.auditEvent.create({
      data: {
        actor,
        action: "assignment.retire",
        entityId: id,
        metadata: { effectiveTo: now.toISOString() },
      },
    });
  });
}

/** Current collection members become ordinary product assignments. Never replace
 * any current/future product or variant assignment through a bulk collection action.
 */
export async function assignCollectionSnapshot(
  input: {
    organizationId: string;
    collectionGid: string;
    collectionTitle: string;
    products: { id: string; title: string }[];
    effectiveFrom: Date;
    programVersionId?: string | null;
  },
  actor: string,
) {
  if (
    !/^gid:\/\/shopify\/Collection\/\d+$/.test(input.collectionGid) ||
    !input.products.length ||
    input.products.length > 1000 ||
    new Set(input.products.map((p) => p.id)).size !== input.products.length ||
    input.products.some((p) => !/^gid:\/\/shopify\/Product\/\d+$/.test(p.id))
  )
    throw new Error(
      "Select a non-empty collection of up to 1,000 unique products",
    );
  if (
    !Number.isFinite(input.effectiveFrom.getTime()) ||
    input.effectiveFrom <= new Date()
  )
    throw new Error("Effective date must be in the future");
  return serializable(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
    });
    if (org.status !== "active")
      throw new Error("Activate this organization before assigning products");
    await validateProgramAssignment(
      tx,
      input.organizationId,
      input.programVersionId,
    );
    const existing = await tx.productAssignment.findMany({
      where: {
        productGid: { in: input.products.map((p) => p.id) },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: input.effectiveFrom } },
        ],
      },
    });
    const protectedProducts = new Set(existing.map((a) => a.productGid));
    const skipped = input.products.filter((p) => protectedProducts.has(p.id));
    const eligible = input.products.filter((p) => !protectedProducts.has(p.id));
    const records = eligible.map((p) => ({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      productGid: p.id,
      variantGid: null,
      displayTitle: p.title,
      effectiveFrom: input.effectiveFrom,
      programVersionId: input.programVersionId ?? null,
    }));
    if (records.length) {
      await tx.productAssignment.createMany({ data: records });
      await tx.auditEvent.create({
        data: {
          actor,
          action: "assignment.collection_snapshot",
          entityId: org.id,
          metadata: {
            collectionGid: input.collectionGid,
            collectionTitle: input.collectionTitle,
            effectiveFrom: input.effectiveFrom.toISOString(),
            products: eligible,
            assignmentIds: records.map((r) => r.id),
            skippedProducts: skipped,
          },
        },
      });
    }
    return { assigned: records.length, skipped };
  });
}

async function validateProgramAssignment(
  tx: Prisma.TransactionClient,
  organizationId: string,
  versionId?: string | null,
) {
  const account = await tx.affiliateAccount.findUnique({
    where: { organizationId },
  });
  if (account && account.status !== "approved")
    throw new Error("Affiliate approval is required before assignment");
  if (account && !versionId)
    throw new Error("Choose a commission program for this affiliate");
  if (versionId) {
    const version = await tx.programVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { program: true },
    });
    if (
      !version.program.active ||
      version.currency !== process.env.SHOP_CURRENCY
    )
      throw new Error("Program is inactive or uses another currency");
  }
}
export function actionError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return "That slug or effective date already exists.";
    return "The change conflicts with existing records. Refresh and try again.";
  }
  return error instanceof Error ? error.message : "Unable to save changes.";
}
