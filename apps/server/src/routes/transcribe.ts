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
// Context detection
// ---------------------------------------------------------------------------

/** Non-browser app context hints */
const APP_HINTS: Record<string, string> = {
  Code: "The user is dictating in VS Code (code editor). Format as clean prose for code comments, commit messages, or documentation. Preserve technical terms.",
  Cursor:
    "The user is dictating in Cursor IDE. Format as clean prose for code comments, commit messages, or documentation. Preserve technical terms.",
  Terminal:
    "The user is dictating for a terminal command or shell. Keep it extremely concise and direct.",
  iTerm2:
    "The user is dictating for a terminal. Keep it extremely concise and direct.",
  Slack:
    "The user is writing a Slack message. Keep it conversational, concise, and professional. Use casual punctuation.",
  Discord:
    "The user is writing a Discord message. Keep it casual and conversational.",
  Messages:
    "The user is writing a text/iMessage. Keep it casual and brief, like a text message.",
  WhatsApp: "The user is writing a WhatsApp message. Keep it casual and brief.",
  Telegram:
    "The user is writing a Telegram message. Keep it casual and conversational.",
  Mail: "The user is composing an email in Apple Mail. Use proper email formatting with clear paragraphs and professional tone.",
  Outlook:
    "The user is composing an email in Outlook. Use proper email formatting with clear paragraphs and professional tone.",
  Notion:
    "The user is writing in Notion. Format with clear structure, proper paragraphs, and clean markdown-friendly prose.",
  Pages:
    "The user is writing a document in Pages. Use proper document formatting.",
  Word: "The user is writing a document in Word. Use proper document formatting.",
  Notes:
    "The user is writing in Apple Notes. Keep it clean and well-structured.",
  Linear:
    "The user is writing in Linear (project management). Keep it concise and action-oriented for issues or comments.",
};

/** URL-based context hints for browser tabs */
function getBrowserContextFromUrl(url: string, title: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");

    // Email
    if (hostname.includes("mail.google.com"))
      return "The user is composing an email in Gmail. Use proper email formatting with clear paragraphs and professional tone.";
    if (
      hostname.includes("outlook.live.com") ||
      hostname.includes("outlook.office")
    )
      return "The user is composing an email in Outlook. Use proper email formatting with clear paragraphs and professional tone.";
    if (hostname.includes("mail.yahoo.com"))
      return "The user is composing an email in Yahoo Mail. Use proper email formatting.";
    if (hostname.includes("proton.me") || hostname.includes("protonmail.com"))
      return "The user is composing an email in ProtonMail. Use proper email formatting.";

    // Calendar
    if (hostname.includes("calendar.google.com"))
      return "The user is working with Google Calendar, likely writing an event description or note. Keep it concise and structured.";

    // Docs / Writing
    if (hostname.includes("docs.google.com"))
      return "The user is writing in Google Docs. Use proper document formatting with clear paragraphs.";
    if (hostname.includes("notion.so"))
      return "The user is writing in Notion. Format with clear structure and proper paragraphs.";
    if (hostname.includes("linear.app"))
      return "The user is writing in Linear (project management). Keep it concise and action-oriented.";

    // Chat / Social
    if (hostname.includes("slack.com"))
      return "The user is writing in Slack (web). Keep it conversational, concise, and professional.";
    if (hostname.includes("discord.com"))
      return "The user is writing in Discord (web). Keep it casual and conversational.";
    if (hostname.includes("web.whatsapp.com"))
      return "The user is writing in WhatsApp Web. Keep it casual and brief.";
    if (hostname.includes("x.com") || hostname.includes("twitter.com"))
      return "The user is composing a post/reply on X (Twitter). Keep it concise (280 chars ideal), punchy, and direct.";
    if (hostname.includes("linkedin.com"))
      return "The user is writing on LinkedIn. Keep it professional and well-structured.";
    if (hostname.includes("reddit.com"))
      return "The user is writing on Reddit. Match the tone of the subreddit — can be casual or detailed.";

    // Code
    if (hostname.includes("github.com"))
      return `The user is on GitHub${title ? ` (${title})` : ""}. Format for issues, PRs, or comments — clear, technical, and well-structured with markdown.`;
    if (hostname.includes("gitlab.com"))
      return "The user is on GitLab. Format for issues, MRs, or comments — clear and technical.";
    if (hostname.includes("stackoverflow.com"))
      return "The user is on Stack Overflow. Format as a clear technical question or answer.";

    // AI tools
    if (
      hostname.includes("chat.openai.com") ||
      hostname.includes("chatgpt.com")
    )
      return "The user is chatting with ChatGPT. Format as a clear, well-structured prompt or message.";
    if (hostname.includes("claude.ai"))
      return "The user is chatting with Claude. Format as a clear, well-structured prompt or message.";
    if (hostname.includes("perplexity.ai"))
      return "The user is using Perplexity. Format as a clear search query or follow-up question.";

    // Search
    if (hostname.includes("google.com") && url.includes("/search"))
      return "The user is typing a Google search query. Keep it as a concise search query, not a full sentence.";

    // Generic browser with a useful title
    if (title)
      return `The user is typing in a browser tab: "${title}" (${hostname}). Adapt your formatting to what seems most appropriate for this context.`;
  } catch {
    // invalid URL
  }
  return null;
}

/** Build a context hint string from the x-app-context header */
function getContextHint(rawContext: string | null): string {
  if (!rawContext) return "";

  try {
    const ctx = JSON.parse(rawContext) as {
      app?: string;
      url?: string;
      title?: string;
      windowTitle?: string;
    };

    // Try URL-based context first (most specific for browsers)
    if (ctx.url) {
      const urlHint = getBrowserContextFromUrl(
        ctx.url,
        ctx.title ?? ctx.windowTitle ?? "",
      );
      if (urlHint) return urlHint;
    }

    // Try window title for Firefox (no URL access)
    if (ctx.windowTitle && ctx.app === "Firefox") {
      return `The user is typing in Firefox. Tab title: "${ctx.windowTitle}". Adapt formatting to what seems appropriate.`;
    }

    // Fall back to app-level hints
    if (ctx.app && APP_HINTS[ctx.app]) return APP_HINTS[ctx.app];
    if (ctx.app) return `The user is dictating in ${ctx.app}.`;
  } catch {
    // Not JSON — treat as plain app name (backward compat)
    if (APP_HINTS[rawContext]) return APP_HINTS[rawContext];
    return `The user is dictating in ${rawContext}.`;
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
  const contextHint = getContextHint(appContext);

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
