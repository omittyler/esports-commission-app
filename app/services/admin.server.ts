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
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P2034", "P2002"].includes(error.code) ||
        attempt >= 3
      )
        throw error;
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
  },
  actor: string,
) {
  return serializable(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
    });
    if (org.status !== "active")
      throw new Error("Activate this organization before assigning products");
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
export function actionError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return "That slug or effective date already exists.";
    return "The change conflicts with existing records. Refresh and try again.";
  }
  return error instanceof Error ? error.message : "Unable to save changes.";
}
