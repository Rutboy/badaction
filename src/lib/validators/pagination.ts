import { z } from "zod";

export const DEFAULT_CARD_PAGE_SIZE = 50;
export const MAX_CARD_PAGE_SIZE = 100;

const pageSizeSchema = z.preprocess(
  (value) => value ?? DEFAULT_CARD_PAGE_SIZE,
  z.coerce.number().int().min(1).max(MAX_CARD_PAGE_SIZE),
);

export const boardPageQuerySchema = z.object({
  limit: pageSizeSchema,
});

export const cardPageQuerySchema = z.object({
  column: z.enum(["WENT_WELL", "TO_IMPROVE", "ACTIONS"]),
  cursor: z.string().uuid().optional(),
  limit: pageSizeSchema,
});

