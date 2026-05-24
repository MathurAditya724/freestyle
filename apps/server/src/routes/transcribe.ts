import { generateText, experimental_transcribe as transcribe } from "ai";
import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import {
  createChatModel,
  createTranscriptionModel,
  getDefaultModels,
} from "../lib/providers.js";
import { getModelCost } from "../routes/models.js";

const transcribeRoute = new Hono();

// ---------------------------------------------------------------------------
// Context detection — uses format_rules from DB
// ---------------------------------------------------------------------------

/** Build a context string from the raw x-app-context header for matching */
function buildMatchContext(rawContext: string | null): string {
  if (!rawContext) return "";

  try {
    const ctx = JSON.parse(rawContext) as {
      app?: string;
      url?: string;
      title?: string;
      windowTitle?: string;
    };

    // Build a combined string for pattern matching
    const parts: string[] = [];
    if (ctx.url) parts.push(ctx.url);
    if (ctx.title) parts.push(ctx.title);
    if (ctx.windowTitle) parts.push(ctx.windowTitle);
    if (ctx.app) parts.push(ctx.app);
    return parts.join(" ");
  } catch {
    return rawContext;
  }
}

/** Look up formatting instructions from the format_rules table */
function getContextHint(
  rawContext: string | null,
  db: ReturnType<typeof getDb>,
): string {
  if (!rawContext) return "";

  const matchStr = buildMatchContext(rawContext);
  if (!matchStr) return "";

  try {
    // User rules (is_default=0) first, then defaults (is_default=1)
    const rows = db
      .prepare(
        "SELECT app_pattern, instructions FROM format_rules ORDER BY is_default ASC, id DESC",
      )
      .all() as { app_pattern: string; instructions: string }[];

    for (const row of rows) {
      const patterns = row.app_pattern.split("|").map((p) => p.trim());
      for (const pattern of patterns) {
        if (pattern && matchStr.toLowerCase().includes(pattern.toLowerCase())) {
          return row.instructions;
        }
      }
    }
  } catch {
    // format_rules table may not exist yet
  }

  // Fallback: extract app name for a generic hint
  try {
    const ctx = JSON.parse(rawContext) as { app?: string };
    if (ctx.app) return `The user is dictating in ${ctx.app}.`;
  } catch {
    // not JSON
  }

  return "";
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

transcribeRoute.post("/", async (c) => {
  const start = Date.now();

  // Get audio from request body
  const contentType = c.req.header("content-type") ?? "";
  let audioData: Uint8Array;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const audioFile = form.get("audio");
    if (!(audioFile instanceof File)) {
      return c.json({ error: "audio field missing or not a file" }, 400);
    }
    audioData = new Uint8Array(await audioFile.arrayBuffer());
  } else {
    audioData = new Uint8Array(await c.req.arrayBuffer());
  }

  if (audioData.length === 0) {
    return c.json({ error: "Empty audio data" }, 400);
  }

  // Get context header (JSON with app, url, title)
  const appContext = c.req.header("x-app-context") ?? null;

  // Get configured models
  const defaults = getDefaultModels();
  if (!defaults.voice) {
    return c.json(
      {
        error: "No voice model configured. Go to Settings > Models to add one.",
      },
      400,
    );
  }

  // Step 1: Transcribe
  const db = getDb();
  const contextHint = getContextHint(appContext, db);
  let rawText: string;

  const langSetting = db
    .prepare("SELECT value FROM settings WHERE key = 'language'")
    .get() as { value: string } | undefined;
  const language = langSetting?.value || undefined;

  try {
    const model = createTranscriptionModel(
      defaults.voice.provider,
      defaults.voice.model_id,
    );
    const result = await transcribe({
      model: model as Parameters<typeof transcribe>[0]["model"],
      audio: audioData,
      ...(language && language !== "auto" ? { language } : {}),
    });
    rawText = result.text;
  } catch (err) {
    return c.json(
      {
        error: "Transcription failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  if (!rawText.trim()) {
    return c.json({
      raw: "",
      cleaned: "",
      model: defaults.voice.model_id,
      durationMs: Date.now() - start,
    });
  }

  // Step 2: LLM post-processing (optional)
  let cleanedText = rawText;
  let inputTokens = 0;
  let outputTokens = 0;

  const llmSetting = db
    .prepare("SELECT value FROM settings WHERE key = 'llm_cleanup'")
    .get() as { value: string } | undefined;
  const llmEnabled = llmSetting?.value === "true";

  if (llmEnabled && defaults.llm) {
    const systemPrompt = `You are an intelligent voice-to-text post-processor that transforms raw dictated speech into clean, polished writing.
${contextHint ? `\nContext: ${contextHint}\n` : ""}
Your job:
- Remove filler words (um, uh, like, you know, basically, so, I mean, etc.)
- Remove false starts, repeated words, and self-corrections (keep only the final intended version)
- Fix grammar, spelling, punctuation, and capitalization
- Convert spoken numbers, dates, and abbreviations to their written forms where appropriate
- Structure run-on sentences into clear, well-punctuated prose
- Preserve the speaker's original meaning, intent, tone, and personality exactly
- Keep technical terms, names, and domain-specific vocabulary intact
- Do NOT add information that wasn't spoken
- Do NOT change the meaning or rewrite beyond what's needed for clarity
- Do NOT add greetings, sign-offs, or any framing text

Output ONLY the cleaned text. No explanations, no quotes, no prefixes.`;

    try {
      const chatModel = createChatModel(
        defaults.llm.provider,
        defaults.llm.model_id,
      );
      const result = await generateText({
        model: chatModel,
        system: systemPrompt,
        prompt: rawText,
      });
      cleanedText = result.text;
      inputTokens = result.usage?.inputTokens ?? 0;
      outputTokens = result.usage?.outputTokens ?? 0;
    } catch (err) {
      console.error("LLM cleanup failed:", err);
    }
  }

  // Step 3: Dictionary replacements
  try {
    const dictRows = db
      .prepare(
        "SELECT id, key, value FROM dictionary ORDER BY length(key) DESC",
      )
      .all() as { id: number; key: string; value: string }[];

    if (dictRows.length > 0) {
      const matchedIds: number[] = [];
      for (const { id, key, value } of dictRows) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`\\b${escaped}\\b`, "gi");
        if (regex.test(cleanedText)) {
          matchedIds.push(id);
          cleanedText = cleanedText.replace(
            new RegExp(`\\b${escaped}\\b`, "gi"),
            value,
          );
        }
      }
      if (matchedIds.length > 0) {
        const updateStmt = db.prepare(
          "UPDATE dictionary SET usage_count = usage_count + 1 WHERE id = ?",
        );
        for (const id of matchedIds) {
          updateStmt.run(id);
        }
      }
    }
  } catch {
    // Dictionary table may not exist yet
  }

  const durationMs = Date.now() - start;

  // Calculate cost from models.dev pricing
  let costUsd = 0;
  if (inputTokens > 0 || outputTokens > 0) {
    try {
      const llmModelId =
        llmEnabled && defaults.llm ? defaults.llm.model_id : null;
      if (llmModelId) {
        const pricing = await getModelCost(llmModelId);
        if (pricing) {
          costUsd = inputTokens * pricing.input + outputTokens * pricing.output;
        }
      }
    } catch {
      // ignore pricing errors
    }
  }

  // Save to history
  try {
    db.prepare(
      `INSERT INTO transcription_history
       (raw_text, cleaned_text, voice_provider, voice_model, llm_provider, llm_model, duration_ms, input_tokens, output_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rawText,
      cleanedText !== rawText ? cleanedText : null,
      defaults.voice.provider,
      defaults.voice.model_id,
      llmEnabled && defaults.llm ? defaults.llm.provider : null,
      llmEnabled && defaults.llm ? defaults.llm.model_id : null,
      durationMs,
      inputTokens,
      outputTokens,
      costUsd,
    );
  } catch (err) {
    console.error("Failed to save history:", err);
  }

  return c.json({
    raw: rawText,
    cleaned: cleanedText,
    model: defaults.voice.model_id,
    durationMs,
  });
});

export default transcribeRoute;
