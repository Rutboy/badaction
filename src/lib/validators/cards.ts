import { z } from "zod";

const textSchema = z.string().trim().min(1).max(1000);
const ownerSchema = z.string().trim().min(1).max(120);

export const createCardSchema = z
  .object({
    column: z.enum(["WENT_WELL", "TO_IMPROVE", "ACTIONS"]),
    text: textSchema,
    owner: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.column === "ACTIONS") {
      if (!data.owner || ownerSchema.safeParse(data.owner).success === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["owner"],
          message: "The owner field is required for ACTIONS.",
        });
      }
      return;
    }

    if (data.owner !== null && data.owner !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["owner"],
        message: "The owner field is only allowed for ACTIONS.",
      });
    }
  });
