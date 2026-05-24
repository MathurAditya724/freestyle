import { generateText, experimental_transcribe as transcribe } from "ai";
import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import {
  createChatModel,
  createTranscriptionModel,
  getDefaultModels,
} from "../lib/providers.js";

const transcribeRoute = new Hono();

// Context-specific formatting hints based on frontmost app
const APP_CONTEXT_HINTS: Record<string, string> = {
  // Code editors
  Code: "The user is dictating in VS Code. Format as clean prose suitable for code comments, commit messages, or documentation. Use technical terminology precisely.",
  Cursor:
    "The user is dictating in Cursor IDE. Format as clean prose suitable for code comments, commit messages, or documentation. Use technical terminology precisely.",
  Terminal: "The user is dictating for a terminal. Keep it concise and direct.",
  iTerm2: "The user is dictating for a terminal. Keep it concise and direct.",
  // Chat apps
  Slack:
    "The user is writing a Slack message. Keep it conversational, concise, and professional. Use casual punctuation.",
  Discord:
    "The user is writing a Discord message. Keep it casual and conversational.",
  Messages: "The user is writing a text message. Keep it casual and brief.",
  WhatsApp: "The user is writing a WhatsApp message. Keep it casual and brief.",
  Telegram:
    "The user is writing a Telegram message. Keep it casual and conversational.",
  // Email
  Mail: "The user is composing an email. Use proper email formatting with clear paragraphs.",
  Outlook:
    "The user is composing an email. Use proper email formatting with clear paragraphs.",
  Gmail:
    "The user is composing an email. Use proper email formatting with clear paragraphs.",
  // Docs
  Notion:
    "The user is writing in Notion. Format with clear structure and proper paragraphs.",
  "Google Docs":
    "The user is writing a document. Use proper document formatting with clear paragraphs.",
  Pages:
    "The user is writing a document. Use proper document formatting with clear paragraphs.",
  Word: "The user is writing a document. Use proper document formatting with clear paragraphs.",
  // Browsers
  Safari:
    "The user is typing in a browser. Adapt to context - could be search, form, or text field.",
  "Google Chrome":
    "The user is typing in a browser. Adapt to context - could be search, form, or text field.",
  Arc: "The user is typing in a browser. Adapt to context - could be search, form, or text field.",
  Firefox:
    "The user is typing in a browser. Adapt to context - could be search, form, or text field.",
};

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

  // Get context headers
  const frontmostApp = c.req.header("x-frontmost-app") ?? null;

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
  let rawText: string;

  // Get language preference
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
    // Build context-aware system prompt
    const appHint = frontmostApp
      ? (APP_CONTEXT_HINTS[frontmostApp] ??
        `The user is dictating in ${frontmostApp}.`)
      : "";

    const systemPrompt = `You are an intelligent voice-to-text post-processor that transforms raw dictated speech into clean, polished writing.
${appHint ? `\nContext: ${appHint}\n` : ""}
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

  // Step 3: Dictionary replacements (no LLM needed, pure regex)
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
          cleanedText = cleanedText.replace(regex, value);
        }
      }
      // Update usage counts
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
    // Dictionary table may not exist yet, ignore
  }

  const durationMs = Date.now() - start;

  // Save to history
  try {
    db.prepare(
      `INSERT INTO transcription_history
       (raw_text, cleaned_text, voice_provider, voice_model, llm_provider, llm_model, duration_ms, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
