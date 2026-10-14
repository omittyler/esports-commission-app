import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/commissions/**/*.test.ts"], environment: "node" },
});
