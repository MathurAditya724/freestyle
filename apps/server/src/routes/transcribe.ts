import { generateText, experimental_transcribe as transcribe } from "ai";
import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import {
  createChatModel,
  createTranscriptionModel,
  getDefaultModels,
} from "../lib/providers.js";

const transcribeRoute = new Hono();

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
    // Raw binary body
    audioData = new Uint8Array(await c.req.arrayBuffer());
  }

  if (audioData.length === 0) {
    return c.json({ error: "Empty audio data" }, 400);
  }

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
  let rawText: string;
  try {
    const model = createTranscriptionModel(
      defaults.voice.provider,
      defaults.voice.model_id,
    );
    const result = await transcribe({
      model: model as Parameters<typeof transcribe>[0]["model"],
      audio: audioData,
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

  // Check if LLM cleanup is enabled
  const db = getDb();
  const llmSetting = db
    .prepare("SELECT value FROM settings WHERE key = 'llm_cleanup'")
    .get() as { value: string } | undefined;
  const llmEnabled = llmSetting?.value === "true";

  if (llmEnabled && defaults.llm) {
    try {
      const chatModel = createChatModel(
        defaults.llm.provider,
        defaults.llm.model_id,
      );
      const result = await generateText({
        model: chatModel,
        system:
          "You are a transcription post-processor. Clean up the following dictated text: fix grammar, punctuation, and formatting. Keep the original meaning and tone. Output ONLY the cleaned text, nothing else.",
        prompt: rawText,
      });
      cleanedText = result.text;
    } catch (err) {
      // If LLM fails, fall back to raw text
      console.error("LLM cleanup failed:", err);
    }
  }

  const durationMs = Date.now() - start;

  // Save to history
  try {
    db.prepare(
      `INSERT INTO transcription_history
       (raw_text, cleaned_text, voice_provider, voice_model, llm_provider, llm_model, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rawText,
      llmEnabled && cleanedText !== rawText ? cleanedText : null,
      defaults.voice.provider,
      defaults.voice.model_id,
      llmEnabled && defaults.llm ? defaults.llm.provider : null,
      llmEnabled && defaults.llm ? defaults.llm.model_id : null,
      durationMs,
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
