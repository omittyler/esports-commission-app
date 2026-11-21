import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

// CI uses only fictional data, a fresh Compose project, and no real credentials.
if (process.env.CI !== "true")
  throw new Error("Run this disposable container rehearsal in CI only");
const config = ".cache/container-test.env";
const base = [
  "compose",
  "--project-name",
  "commission-smoke",
  "--env-file",
  config,
  "-f",
  "compose.synology.yaml",
];
const run = (...args) =>
  execFileSync("docker", [...base, ...args], {
    stdio: "inherit",
    timeout: 180000,
  });
await mkdir(".cache", { recursive: true });
await mkdir("backups", { recursive: true });
await writeFile(
  config,
  [
    `POSTGRES_PASSWORD=${"a".repeat(64)}`,
    `APP_DB_PASSWORD=${"b".repeat(64)}`,
    "LOCAL_APP_PORT=3001",
    "SHOPIFY_API_KEY=container-test-only",
    "SHOPIFY_API_SECRET=container-test-secret-not-a-real-credential",
    "SHOPIFY_APP_URL=https://example.invalid",
    "PORTAL_URL=https://example.invalid",
    "SHOPIFY_SHOP=example.myshopify.com",
    "SUPABASE_URL=https://example.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY=container-test-publishable-key",
    `PORTAL_SESSION_SECRET=${"c".repeat(64)}`,
  ].join("\n") + "\n",
  { mode: 0o600 },
);

async function healthy() {
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:3001/health", {
        signal: AbortSignal.timeout(3000),
      });
      if (response.status === 204) return;
    } catch {
      /* Container is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Container health check did not pass");
}
try {
  run("config", "--quiet");
  run("up", "-d", "app");
  await healthy();
  const root = await fetch("http://127.0.0.1:3001/", { redirect: "manual" });
  if (root.status !== 302 || root.headers.get("location") !== "/portal/login")
    throw new Error("Portal landing redirect failed");
  const login = await fetch("http://127.0.0.1:3001/portal/login");
  if (
    login.status !== 200 ||
    !(await login.text()).includes("Affiliate sign-in")
  )
    throw new Error("Portal HTML did not render");
  run(
    "exec",
    "-T",
    "-e",
    "DEPLOYMENT_TEST_MODE=true",
    "app",
    "node",
    "--import",
    "tsx",
    "scripts/container-fixture.ts",
  );
  run(
    "exec",
    "-T",
    "app",
    "node",
    "--import",
    "tsx",
    "scripts/database-manifest.ts",
    "/tmp/source-manifest.json",
  );
  run("cp", "app:/tmp/source-manifest.json", "backups/source-manifest.json");
  run(
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "commission_admin",
    "-d",
    "commission",
    "-Fc",
    "--no-owner",
    "--no-acl",
    "-f",
    "/backups/container-test.dump",
  );
  run(
    "exec",
    "-T",
    "postgres",
    "createdb",
    "-U",
    "commission_admin",
    "commission_restore",
  );
  run(
    "exec",
    "-T",
    "postgres",
    "pg_restore",
    "-U",
    "commission_admin",
    "-d",
    "commission_restore",
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    "/backups/container-test.dump",
  );
  run(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "commission_admin",
    "-d",
    "commission_restore",
    "-f",
    "/docker-entrypoint-initdb.d/30-grants.sql",
  );
  run(
    "exec",
    "-T",
    "app",
    "node",
    "--import",
    "tsx",
    "scripts/database-manifest.ts",
    "/tmp/restored-manifest.json",
    "commission_restore",
  );
  run(
    "cp",
    "app:/tmp/restored-manifest.json",
    "backups/restored-manifest.json",
  );
  execFileSync(
    process.execPath,
    [
      "scripts/compare-manifests.mjs",
      "backups/source-manifest.json",
      "backups/restored-manifest.json",
    ],
    { stdio: "inherit" },
  );
  const restoredURL = `postgresql://commission_app:${"b".repeat(64)}@postgres:5432/commission_restore?schema=public`;
  run(
    "exec",
    "-T",
    "-e",
    "DEPLOYMENT_TEST_MODE=true",
    "-e",
    `DATABASE_URL=${restoredURL}`,
    "app",
    "node",
    "--import",
    "tsx",
    "scripts/container-fixture.ts",
    "--verify",
  );
  run(
    "run",
    "--rm",
    "-T",
    "worker",
    "node",
    "--import",
    "tsx",
    "scripts/process-webhooks.ts",
    "--once",
  );
  run("restart", "postgres", "app");
  await healthy();
  run(
    "exec",
    "-T",
    "-e",
    "DEPLOYMENT_TEST_MODE=true",
    "app",
    "node",
    "--import",
    "tsx",
    "scripts/container-fixture.ts",
    "--verify",
  );
  console.log(
    "PASS: container startup, restricted role, exact ledger, restore, worker exit, and persistent restart.",
  );
} catch (error) {
  run("logs", "--tail", "80");
  throw error;
} finally {
  // This project and its volumes contain exclusively the disposable CI fixture.
  run("down", "--volumes", "--remove-orphans");
}
