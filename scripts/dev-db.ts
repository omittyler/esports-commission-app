import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

// Development only. Persistent data stays in an ignored directory; loopback only.
const databaseDir = fileURLToPath(
  new URL("../.postgres-dev/", import.meta.url),
);
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: "commission",
  password: "commission",
  port: 55432,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: (error) => console.error(error),
});
let stopping = false;
let started = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (started) await postgres.stop();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

try {
  if (!existsSync(new URL("../.postgres-dev/PG_VERSION", import.meta.url))) {
    await postgres.initialise();
  }
  await postgres.start();
  started = true;
  const client = postgres.getPgClient();
  await client.connect();
  try {
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      ["commission"],
    );
    if (!result.rowCount) await postgres.createDatabase("commission");
  } finally {
    await client.end();
  }
  console.log(
    "Local PostgreSQL ready on 127.0.0.1:55432. Data persists across restarts.",
  );
  console.log(
    "Keep this terminal running. Ctrl+C stops PostgreSQL without deleting data.",
  );
} catch (error) {
  console.error(error);
  if (started) await postgres.stop();
  process.exitCode = 1;
}
