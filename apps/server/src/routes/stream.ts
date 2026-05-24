import { upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import { getDefaultModels } from "../lib/providers.js";
import {
  getApiKeyForProvider,
  openStreamingSession,
  supportsStreaming,
} from "../lib/streaming-stt.js";

const stream = new Hono();

stream.get(
  "/",
  upgradeWebSocket(() => {
    let upstream: ReturnType<typeof openStreamingSession> | null = null;
    let closed = false;
    const startTime = Date.now();
    let voiceDefaults: { provider: string; model_id: string } | null = null;

    return {
      onOpen(_event, ws) {
        const defaults = getDefaultModels();
        if (!defaults.voice) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "No voice model configured",
            }),
          );
          ws.close();
          return;
        }
        voiceDefaults = defaults.voice;

        const apiKey = getApiKeyForProvider(defaults.voice.provider);
        if (!apiKey) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: `No API key for ${defaults.voice.provider}`,
            }),
          );
          ws.close();
          return;
        }

        const modelShort = defaults.voice.model_id.includes("/")
          ? defaults.voice.model_id.split("/").pop()!
          : defaults.voice.model_id;

        const canStream = supportsStreaming(
          defaults.voice.provider,
          defaults.voice.model_id,
        );

        ws.send(
          JSON.stringify({
            type: "config",
            model: modelShort,
            streaming: canStream,
          }),
        );

        if (!canStream) {
          ws.close();
          return;
        }

        try {
          upstream = openStreamingSession({
            apiKey,
            model: modelShort,
            callbacks: {
              onReady: (model) => {
                ws.send(JSON.stringify({ type: "session.ready", model }));
              },
              onPartial: (text) => {
                ws.send(JSON.stringify({ type: "partial", text }));
              },
              onFinal: (text) => {
                ws.send(JSON.stringify({ type: "final", text }));

                // Save to history
                try {
                  const db = getDb();
                  db.prepare(
                    `INSERT INTO transcription_history
                     (raw_text, voice_provider, voice_model, duration_ms)
                     VALUES (?, ?, ?, ?)`,
                  ).run(
                    text,
                    voiceDefaults!.provider,
                    voiceDefaults!.model_id,
                    Date.now() - startTime,
                  );
                } catch (err) {
                  console.error("Failed to save history:", err);
                }

                cleanup();
              },
              onError: (message) => {
                ws.send(JSON.stringify({ type: "error", message }));
                cleanup();
              },
              onClose: () => {
                if (!closed) cleanup();
              },
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: "error", message }));
          ws.close();
        }

        function cleanup(): void {
          if (closed) return;
          closed = true;
          try {
            upstream?.close();
          } catch {}
          try {
            ws.close();
          } catch {}
        }
      },

      onMessage(event, ws) {
        if (!upstream) return;

        // Binary data = audio chunk
        if (event.data instanceof ArrayBuffer) {
          upstream.sendAudio(event.data);
          return;
        }

        // Text data = JSON command
        let msg: { type: string };
        try {
          msg = JSON.parse(
            typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer),
          );
        } catch {
          return;
        }

        if (msg.type === "commit") {
          upstream.commit();
        } else if (msg.type === "cancel") {
          closed = true;
          try {
            upstream.close();
          } catch {}
          try {
            ws.close();
          } catch {}
        }
      },

      onClose() {
        if (!closed) {
          closed = true;
          try {
            upstream?.close();
          } catch {}
        }
      },

      onError() {
        if (!closed) {
          closed = true;
          try {
            upstream?.close();
          } catch {}
        }
      },
    };
  }),
);

export default stream;
