import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [
    {
      name: "cloudflare-server-adapters",
      enforce: "pre",
      resolveId(source, importer) {
        const full = (
          source.startsWith(".") && importer
            ? resolve(dirname(importer.split("?")[0]), source)
            : source
        )
          .replaceAll("\\", "/")
          .replace(/\?.*$/, "")
          .replace(/\.(tsx?|jsx?)$/, "");
        const target = new Map([
          [
            resolve(root, "app/db.server").replaceAll("\\", "/"),
            "cloudflare/database.server.ts",
          ],
          [
            resolve(root, "app/shopify.server").replaceAll("\\", "/"),
            "cloudflare/shopify.server.ts",
          ],
        ]).get(full);
        if (target) return resolve(root, target).replaceAll("\\", "/");
        if (
          source === "@prisma/client" ||
          full ===
            resolve(root, "cloudflare/generated/client").replaceAll("\\", "/")
        )
          return resolve(root, "cloudflare/generated/wasm.js").replaceAll(
            "\\",
            "/",
          );
      },
    },
    cloudflare({
      configPath: "wrangler.jsonc",
      viteEnvironment: { name: "ssr" },
    }),
    reactRouter(),
  ],
  build: {
    assetsInlineLimit: 0,
    commonjsOptions: { include: [/node_modules/, /cloudflare[\\/]generated/] },
  },
});
