import { settingValueSchema } from "@freestyle/validations";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getDb } from "../lib/db.js";

const settings = new Hono();

// Get all settings
settings.get("/", (c) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return c.json(result);
});

// Get a single setting
settings.get("/:key", (c) => {
  const db = getDb();
  const key = c.req.param("key");
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;

  if (!row) {
    return c.json({ error: "Setting not found" }, 404);
  }
  return c.json({ key, value: row.value });
});

// Upsert a setting
settings.put("/:key", zValidator("json", settingValueSchema), async (c) => {
  const db = getDb();
  const key = c.req.param("key");
  const body = c.req.valid("json");

  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, String(body.value));

  return c.json({ key, value: body.value });
});

// Delete a setting
settings.delete("/:key", (c) => {
  const db = getDb();
  const key = c.req.param("key");
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  return c.json({ ok: true });
});

export default settings;
