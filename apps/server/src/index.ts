import { Hono } from "hono";
import { cors } from "hono/cors";
import { initSentry } from "./lib/sentry.js";
import apiKeys from "./routes/api-keys.js";
import dictionary from "./routes/dictionary.js";
import feedback from "./routes/feedback.js";
import formats from "./routes/formats.js";
import history from "./routes/history.js";
import models from "./routes/models.js";
import settings from "./routes/settings.js";
import stream from "./routes/stream.js";
import transcribe from "./routes/transcribe.js";

// Initialize Sentry as early as possible
initSentry();

const app = new Hono();

// Allow requests from the Electron renderer (skip for WebSocket upgrades)
app.use("*", async (c, next) => {
  // Don't apply CORS to WebSocket upgrade requests
  if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
    return next();
  }
  return cors()(c, next);
});

app.get("/", (c) => {
  return c.text("Freestyle API");
});

// Mount routes
app.route("/api/settings", settings);
app.route("/api/keys", apiKeys);
app.route("/api/models", models);
app.route("/api/transcribe", transcribe);
app.route("/api/history", history);
app.route("/api/dictionary", dictionary);
app.route("/api/formats", formats);
app.route("/api/feedback", feedback);
app.route("/stream", stream);

export default app;
