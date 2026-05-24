import { z } from "zod/v3";

export const createDictionarySchema = z.object({
  key: z.string().min(1, "Key is required"),
  value: z.string().min(1, "Value is required"),
});

export const updateDictionarySchema = z.object({
  key: z.string().min(1, "Key is required").optional(),
  value: z.string().min(1, "Value is required").optional(),
});

export type CreateDictionaryInput = z.infer<typeof createDictionarySchema>;
export type UpdateDictionaryInput = z.infer<typeof updateDictionarySchema>;
