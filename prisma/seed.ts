import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  for (const org of [{ name: "Team Alpha", slug: "team-alpha", rateBps: 2000 }, { name: "Team Bravo", slug: "team-bravo", rateBps: 1500 }]) {
    await db.organization.upsert({ where: { slug: org.slug }, update: {}, create: { name: org.name, slug: org.slug, rates: { create: { rateBps: org.rateBps, effectiveFrom: new Date("2026-01-01T00:00:00Z") } } } });
  }
} finally { await db.$disconnect(); }
