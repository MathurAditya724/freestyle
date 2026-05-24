import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod/v4";
import { getDb } from "../lib/db.js";

const createSchema = z.object({
  key: z.string().min(1, "Key is required"),
  value: z.string().min(1, "Value is required"),
});

const updateSchema = z.object({
  key: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
});

const dictionary = new Hono();

interface DictionaryRow {
  id: number;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

// List entries (paginated, searchable, sortable)
dictionary.get("/", (c) => {
  const db = getDb();
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const offset = Number(c.req.query("offset") || 0);
  const search = c.req.query("search")?.trim() || "";
  const orderByParam = c.req.query("orderBy") || "-created_at";

  const desc = orderByParam.startsWith("-");
  const column = desc ? orderByParam.slice(1) : orderByParam;
  const allowedColumns = new Set(["created_at", "updated_at", "key"]);
  const orderColumn = allowedColumns.has(column) ? column : "created_at";
  const orderDir = desc ? "DESC" : "ASC";

  let rows: DictionaryRow[];
  let countRow: { count: number };

  if (search) {
    const pattern = `%${search}%`;
    rows = db
      .prepare(
        `SELECT * FROM dictionary WHERE key LIKE ? OR value LIKE ? ORDER BY ${orderColumn} ${orderDir} LIMIT ? OFFSET ?`,
      )
      .all(pattern, pattern, limit, offset) as unknown as DictionaryRow[];

    countRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM dictionary WHERE key LIKE ? OR value LIKE ?",
      )
      .get(pattern, pattern) as { count: number };
  } else {
    rows = db
      .prepare(
        `SELECT * FROM dictionary ORDER BY ${orderColumn} ${orderDir} LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as unknown as DictionaryRow[];

    countRow = db
      .prepare("SELECT COUNT(*) as count FROM dictionary")
      .get() as unknown as { count: number };
  }

  return c.json({
    items: rows,
    total: countRow.count,
    limit,
    offset,
  });
});

// Get all entries (for replacement engine - no pagination)
dictionary.get("/all", (c) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM dictionary ORDER BY length(key) DESC")
    .all() as { key: string; value: string }[];
  return c.json(rows);
});

// Get a single entry
dictionary.get("/:id", (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const row = db.prepare("SELECT * FROM dictionary WHERE id = ?").get(id) as
    | DictionaryRow
    | undefined;

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// Create entry
dictionary.post("/", zValidator("json", createSchema), async (c) => {
  const db = getDb();
  const body = c.req.valid("json");

  try {
    const result = db
      .prepare(`INSERT INTO dictionary (key, value) VALUES (?, ?)`)
      .run(body.key.trim().toLowerCase(), body.value.trim());

    return c.json(
      {
        id: result.lastInsertRowid,
        key: body.key.trim().toLowerCase(),
        value: body.value.trim(),
      },
      201,
    );
  } catch {
    return c.json(
      { error: "A dictionary entry with this key already exists" },
      409,
    );
  }
});

// Update entry
dictionary.put("/:id", zValidator("json", updateSchema), async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const body = c.req.valid("json");

  const existing = db
    .prepare("SELECT * FROM dictionary WHERE id = ?")
    .get(id) as DictionaryRow | undefined;
  if (!existing) return c.json({ error: "Not found" }, 404);

  const newKey = body.key?.trim().toLowerCase() ?? existing.key;
  const newValue = body.value?.trim() ?? existing.value;

  try {
    db.prepare(
      `UPDATE dictionary SET key = ?, value = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(newKey, newValue, id);

    return c.json({ id, key: newKey, value: newValue });
  } catch {
    return c.json(
      { error: "A dictionary entry with this key already exists" },
      409,
    );
  }
});

// Delete entry
dictionary.delete("/:id", (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  db.prepare("DELETE FROM dictionary WHERE id = ?").run(id);
  return c.json({ ok: true });
});

export default dictionary;
