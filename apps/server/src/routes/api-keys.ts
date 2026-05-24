import { apiKeySchema } from "@freestyle/validations";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getDb } from "../lib/db.js";

const apiKeys = new Hono();

// List stored API keys (provider names + created_at, NOT the actual keys)
apiKeys.get("/", (c) => {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT provider, created_at FROM api_keys ORDER BY created_at DESC",
    )
    .all() as { provider: string; created_at: string }[];
  return c.json(rows);
});

// Check if a specific provider has a key stored
apiKeys.get("/:provider", (c) => {
  const db = getDb();
  const provider = c.req.param("provider");
  const row = db
    .prepare("SELECT provider, created_at FROM api_keys WHERE provider = ?")
    .get(provider) as { provider: string; created_at: string } | undefined;

  if (!row) {
    return c.json({ error: "No API key for this provider" }, 404);
  }
  return c.json({
    provider: row.provider,
    configured: true,
    created_at: row.created_at,
  });
});

// Store or update an API key
apiKeys.post("/", zValidator("json", apiKeySchema), async (c) => {
  const db = getDb();
  const body = c.req.valid("json");

  db.prepare(
    `INSERT INTO api_keys (provider, key, created_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(provider) DO UPDATE SET key = excluded.key, created_at = datetime('now')`,
  ).run(body.provider, body.key);

  return c.json({ provider: body.provider, configured: true });
});

// Delete an API key
apiKeys.delete("/:provider", (c) => {
  const db = getDb();
  const provider = c.req.param("provider");
  db.prepare("DELETE FROM api_keys WHERE provider = ?").run(provider);
  return c.json({ ok: true });
});

export default apiKeys;
