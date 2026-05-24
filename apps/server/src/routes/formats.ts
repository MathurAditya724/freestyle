import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod/v3";
import { getDb } from "../lib/db.js";

const createSchema = z.object({
  app_pattern: z.string().min(1, "App pattern is required"),
  label: z.string().min(1, "Label is required"),
  instructions: z.string().min(1, "Instructions are required"),
});

const updateSchema = z.object({
  app_pattern: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  instructions: z.string().min(1).optional(),
});

const formats = new Hono();

interface FormatRow {
  id: number;
  app_pattern: string;
  label: string;
  instructions: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

// List format rules (paginated, searchable)
formats.get("/", (c) => {
  const db = getDb();
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const offset = Number(c.req.query("offset") || 0);
  const search = c.req.query("search")?.trim() || "";

  let rows: FormatRow[];
  let countRow: { count: number };

  if (search) {
    const pattern = `%${search}%`;
    rows = db
      .prepare(
        "SELECT * FROM format_rules WHERE label LIKE ? OR app_pattern LIKE ? OR instructions LIKE ? ORDER BY is_default ASC, label ASC LIMIT ? OFFSET ?",
      )
      .all(pattern, pattern, pattern, limit, offset) as unknown as FormatRow[];
    countRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM format_rules WHERE label LIKE ? OR app_pattern LIKE ? OR instructions LIKE ?",
      )
      .get(pattern, pattern, pattern) as unknown as { count: number };
  } else {
    rows = db
      .prepare(
        "SELECT * FROM format_rules ORDER BY is_default ASC, label ASC LIMIT ? OFFSET ?",
      )
      .all(limit, offset) as unknown as FormatRow[];
    countRow = db
      .prepare("SELECT COUNT(*) as count FROM format_rules")
      .get() as unknown as { count: number };
  }

  return c.json({
    items: rows,
    total: countRow.count,
    limit,
    offset,
  });
});

// Match a context string against format rules
// Used by the transcription pipeline to find the right format
formats.get("/match", (c) => {
  const db = getDb();
  const context = c.req.query("context") ?? "";
  if (!context) return c.json(null);

  const rows = db
    .prepare("SELECT * FROM format_rules ORDER BY is_default ASC, id DESC")
    .all() as unknown as FormatRow[];

  // User rules (is_default=0) take priority over defaults (is_default=1)
  for (const row of rows) {
    const patterns = row.app_pattern.split("|").map((p) => p.trim());
    for (const pattern of patterns) {
      if (pattern && context.toLowerCase().includes(pattern.toLowerCase())) {
        return c.json(row);
      }
    }
  }

  return c.json(null);
});

// Create a custom format rule
formats.post("/", zValidator("json", createSchema), async (c) => {
  const db = getDb();
  const body = c.req.valid("json");

  const result = db
    .prepare(
      "INSERT INTO format_rules (app_pattern, label, instructions, is_default) VALUES (?, ?, ?, 0)",
    )
    .run(body.app_pattern, body.label, body.instructions);

  return c.json({ id: result.lastInsertRowid, ...body }, 201);
});

// Update a format rule
formats.put("/:id", zValidator("json", updateSchema), async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const body = c.req.valid("json");

  const existing = db
    .prepare("SELECT * FROM format_rules WHERE id = ?")
    .get(id) as FormatRow | undefined;
  if (!existing) return c.json({ error: "Not found" }, 404);

  db.prepare(
    "UPDATE format_rules SET app_pattern = ?, label = ?, instructions = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(
    body.app_pattern ?? existing.app_pattern,
    body.label ?? existing.label,
    body.instructions ?? existing.instructions,
    id,
  );

  return c.json({ ok: true });
});

// Delete a format rule
formats.delete("/:id", (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  db.prepare("DELETE FROM format_rules WHERE id = ?").run(id);
  return c.json({ ok: true });
});

// Reset to defaults
formats.post("/reset", (c) => {
  const db = getDb();
  db.exec("DELETE FROM format_rules WHERE is_default = 0");
  return c.json({ ok: true });
});

export default formats;
