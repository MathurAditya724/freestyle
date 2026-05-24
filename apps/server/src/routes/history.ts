import { Hono } from "hono";
import { getDb } from "../lib/db.js";

const history = new Hono();

interface HistoryRow {
  id: number;
  raw_text: string;
  cleaned_text: string | null;
  voice_provider: string;
  voice_model: string;
  llm_provider: string | null;
  llm_model: string | null;
  duration_ms: number;
  audio_duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

// List history (paginated)
history.get("/", (c) => {
  const db = getDb();
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const offset = Number(c.req.query("offset") || 0);

  const rows = db
    .prepare(
      "SELECT * FROM transcription_history ORDER BY created_at DESC LIMIT ? OFFSET ?",
    )
    .all(limit, offset) as HistoryRow[];

  const countRow = db
    .prepare("SELECT COUNT(*) as count FROM transcription_history")
    .get() as { count: number };

  return c.json({
    items: rows,
    total: countRow.count,
    limit,
    offset,
  });
});

// Get aggregate stats
history.get("/stats", (c) => {
  const db = getDb();

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(duration_ms), 0) as total_duration_ms,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd,
        COALESCE(AVG(duration_ms), 0) as avg_duration_ms
      FROM transcription_history`,
    )
    .get() as {
    total_sessions: number;
    total_duration_ms: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
    avg_duration_ms: number;
  };

  // Today's stats
  const today = db
    .prepare(
      `SELECT COUNT(*) as sessions, COALESCE(SUM(cost_usd), 0) as cost
       FROM transcription_history
       WHERE date(created_at) = date('now')`,
    )
    .get() as { sessions: number; cost: number };

  return c.json({
    ...stats,
    today_sessions: today.sessions,
    today_cost: today.cost,
  });
});

// Get a single history entry
history.get("/:id", (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const row = db
    .prepare("SELECT * FROM transcription_history WHERE id = ?")
    .get(id) as HistoryRow | undefined;

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// Delete a history entry
history.delete("/:id", (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  db.prepare("DELETE FROM transcription_history WHERE id = ?").run(id);
  return c.json({ ok: true });
});

// Clear all history
history.delete("/", (c) => {
  const db = getDb();
  db.exec("DELETE FROM transcription_history");
  return c.json({ ok: true });
});

export default history;
