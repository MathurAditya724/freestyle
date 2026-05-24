import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod/v4";
import { Sentry } from "../lib/sentry.js";

const feedback = new Hono();

const feedbackSchema = z.object({
  message: z.string().min(1, "Message is required"),
  type: z.enum(["general", "bug", "feature"]).optional().default("general"),
  email: z.email().optional(),
});

feedback.post("/", zValidator("json", feedbackSchema), async (c) => {
  const body = c.req.valid("json");

  Sentry.captureMessage(`User Feedback: ${body.message}`, {
    level: "info",
    tags: {
      feedback_type: body.type,
    },
    extra: {
      message: body.message,
      email: body.email,
      type: body.type,
    },
    user: body.email ? { email: body.email } : undefined,
  });

  return c.json({ ok: true });
});

export default feedback;
