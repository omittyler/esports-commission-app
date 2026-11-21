import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /.*app\/db\.server(?:\.ts)?$/,
        replacement: resolve("cloudflare/database.server.ts"),
      },
      {
        find: "@prisma/client",
        replacement: resolve("cloudflare/generated/index.js"),
      },
    ],
  },
  plugins: [
    {
      name: "d1-test-database",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          importer &&
          source.startsWith(".") &&
          /[\\/]db\.server(?:\.ts)?$/.test(source)
        ) {
          const path = resolve(importer, "..", source).replaceAll("\\", "/");
          if (
            path.endsWith("/app/db.server") ||
            path.endsWith("/app/db.server.ts")
          )
            return resolve("cloudflare/database.server.ts");
        }
      },
    },
  ],
  test: {
    include: ["tests/d1/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
