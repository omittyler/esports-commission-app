import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import db, { withDatabase } from "../cloudflare/database.server";
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: "wrangler.jsonc",
});
try {
  await withDatabase(proxy.env.DB, async () => {
    for (const org of [
      { name: "Team Alpha", slug: "team-alpha", rateBps: 2000 },
      { name: "Team Bravo", slug: "team-bravo", rateBps: 1500 },
    ]) {
      await db.organization.upsert({
        where: { slug: org.slug },
        update: {},
        create: {
          name: org.name,
          slug: org.slug,
          rates: {
            create: {
              rateBps: org.rateBps,
              effectiveFrom: new Date("2026-01-01T00:00:00Z"),
            },
          },
        },
      });
    }
  });
  console.log(
    "Local Team Alpha and Team Bravo fixtures are ready; existing rates were preserved.",
  );
} finally {
  await proxy.dispose();
}
