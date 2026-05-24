import { z } from "zod/v3";

export const feedbackTypes = ["general", "bug", "feature"] as const;

export const feedbackSchema = z.object({
  message: z.string().min(1, "Message is required"),
  type: z.enum(feedbackTypes),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
