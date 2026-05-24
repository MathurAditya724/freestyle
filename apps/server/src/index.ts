import { Hono } from "hono";
import { cors } from "hono/cors";
import settings from "./routes/settings.js";
import apiKeys from "./routes/api-keys.js";
import models from "./routes/models.js";
import transcribe from "./routes/transcribe.js";
import history from "./routes/history.js";
import stream from "./routes/stream.js";

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
app.route("/stream", stream);

export default app;
