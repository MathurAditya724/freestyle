import { Hono } from "hono";
import { getDb } from "../lib/db.js";

const models = new Hono();

// Voice model families we care about from models.dev
const VOICE_FAMILIES = new Set([
  "whisper",
  "tts",
  "elevenlabs",
  "deepgram",
  "azure-speech",
]);

// In-memory cache for models.dev data
let modelsCache: { data: unknown; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchModelsFromRegistry(): Promise<Record<string, unknown>> {
  if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL_MS) {
    return modelsCache.data as Record<string, unknown>;
  }

  const res = await fetch("https://models.dev/api.json");
  if (!res.ok) {
    throw new Error(`Failed to fetch models.dev: ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  modelsCache = { data, fetchedAt: Date.now() };
  return data;
}

interface RegistryModel {
  id: string;
  name: string;
  family?: string;
  modalities?: { input?: string[]; output?: string[] };
  cost?: { input?: number; output?: number };
  [key: string]: unknown;
}

interface RegistryProvider {
  id: string;
  name: string;
  models?: Record<string, RegistryModel>;
  [key: string]: unknown;
}

interface AvailableModel {
  provider_id: string;
  provider_name: string;
  model_id: string;
  model_name: string;
  family: string;
  type: "voice" | "llm";
  cost_input?: number;
  cost_output?: number;
}

// Get available models from models.dev, filtered to voice agents and LLMs
models.get("/available", async (c) => {
  try {
    const registry = await fetchModelsFromRegistry();
    const available: AvailableModel[] = [];

    for (const [providerId, providerData] of Object.entries(registry)) {
      const provider = providerData as RegistryProvider;
      if (!provider.models) continue;

      for (const [, model] of Object.entries(provider.models)) {
        const family = model.family ?? "";
        const inputMods = model.modalities?.input ?? [];
        const outputMods = model.modalities?.output ?? [];

        // Voice models: have audio input or audio output, or known voice families
        const isVoice =
          VOICE_FAMILIES.has(family) ||
          inputMods.includes("audio") ||
          outputMods.includes("audio");

        // LLM models: text input + text output
        const isLLM =
          inputMods.includes("text") && outputMods.includes("text");

        if (isVoice) {
          available.push({
            provider_id: providerId,
            provider_name: provider.name ?? providerId,
            model_id: model.id,
            model_name: model.name,
            family,
            type: "voice",
            cost_input: model.cost?.input,
            cost_output: model.cost?.output,
          });
        }

        if (isLLM && !isVoice) {
          available.push({
            provider_id: providerId,
            provider_name: provider.name ?? providerId,
            model_id: model.id,
            model_name: model.name,
            family,
            type: "llm",
            cost_input: model.cost?.input,
            cost_output: model.cost?.output,
          });
        }
      }
    }

    return c.json(available);
  } catch (err) {
    return c.json(
      { error: "Failed to fetch models", detail: String(err) },
      500,
    );
  }
});

// Get user's configured models
models.get("/configured", (c) => {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, provider, model_id, model_name, type, is_default, created_at FROM model_configs ORDER BY type, is_default DESC, created_at DESC",
    )
    .all() as {
    id: number;
    provider: string;
    model_id: string;
    model_name: string;
    type: string;
    is_default: number;
    created_at: string;
  }[];
  return c.json(rows);
});

// Add a configured model
models.post("/configured", async (c) => {
  const db = getDb();
  const body = await c.req.json<{
    provider: string;
    model_id: string;
    model_name: string;
    type: "voice" | "llm";
    is_default?: boolean;
  }>();

  if (!body.provider || !body.model_id || !body.model_name || !body.type) {
    return c.json(
      { error: "provider, model_id, model_name, and type are required" },
      400,
    );
  }

  // If setting as default, unset any existing default for this type
  if (body.is_default) {
    db.prepare("UPDATE model_configs SET is_default = 0 WHERE type = ?").run(
      body.type,
    );
  }

  const result = db
    .prepare(
      `INSERT INTO model_configs (provider, model_id, model_name, type, is_default)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider, model_id, type) DO UPDATE SET
         model_name = excluded.model_name,
         is_default = excluded.is_default`,
    )
    .run(
      body.provider,
      body.model_id,
      body.model_name,
      body.type,
      body.is_default ? 1 : 0,
    );

  return c.json({ id: result.lastInsertRowid, ...body }, 201);
});

// Set a model as default
models.put("/configured/:id/default", (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));

  const row = db
    .prepare("SELECT type FROM model_configs WHERE id = ?")
    .get(id) as { type: string } | undefined;
  if (!row) {
    return c.json({ error: "Model config not found" }, 404);
  }

  // Unset existing default for this type, then set new one
  db.prepare("UPDATE model_configs SET is_default = 0 WHERE type = ?").run(
    row.type,
  );
  db.prepare("UPDATE model_configs SET is_default = 1 WHERE id = ?").run(id);

  return c.json({ ok: true });
});

// Delete a configured model
models.delete("/configured/:id", (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  db.prepare("DELETE FROM model_configs WHERE id = ?").run(id);
  return c.json({ ok: true });
});

export default models;
