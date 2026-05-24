import { z } from "zod/v3";

export const SortOrder = {
  ASC: "asc",
  DESC: "desc",
} as const;

export const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  orderBy: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (val.startsWith("-")) {
        return { column: val.slice(1), order: SortOrder.DESC };
      }
      return { column: val, order: SortOrder.ASC };
    }),
});

export type QueryInput = z.infer<typeof querySchema>;
