import db from "../db.server";

export async function loader() {
  try {
    await db.$queryRaw`SELECT 1`;
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
