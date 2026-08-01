import { z } from "zod";

export const TARGET_DEFAULT_PAGE_SIZE = 50;
export const TARGET_MAX_PAGE_SIZE = 100;
export const TARGET_MAX_BOARD_COLUMNS = 10;
export const TARGET_MAX_COLUMN_VOTE_LIMIT = 20;
export const TARGET_MAX_GROUP_CARDS = 100;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

const trimmedString = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableTrimmedString = (maximum: number) => trimmedString(maximum).nullable();

export const targetUuidV4Schema = z
  .string()
  .regex(UUID_V4_PATTERN, "Ожидается UUID v4")
  .transform((value) => value.toLowerCase());

export const revisionSchema = z
  .string()
  .regex(REVISION_PATTERN, "Revision должна быть канонической десятичной строкой")
  .max(19)
  .refine(
    (value) =>
      !REVISION_PATTERN.test(value) || BigInt(value) <= MAX_POSTGRES_BIGINT,
    {
    message: "Revision превышает диапазон PostgreSQL bigint",
    },
  );

export const boardTitleSchema = trimmedString(120);
export const columnTitleSchema = trimmedString(80);
export const cardTextSchema = trimmedString(1000);
export const cardAuthorSchema = nullableTrimmedString(120);
export const groupTitleSchema = nullableTrimmedString(120);
export const actionItemTextSchema = trimmedString(1000);
export const actionItemAssigneeSchema = nullableTrimmedString(120);
export const columnVoteLimitSchema = z.number().int().min(0).max(TARGET_MAX_COLUMN_VOTE_LIMIT);

export const itemRefSchema = z
  .object({
    kind: z.enum(["CARD", "GROUP"]),
    id: targetUuidV4Schema,
  })
  .strict();

export const itemPlacementSchema = z
  .object({
    before: itemRefSchema.nullable(),
    after: itemRefSchema.nullable(),
  })
  .strict()
  .superRefine(({ before, after }, context) => {
    if (before && after && before.kind === after.kind && before.id === after.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["after"],
        message: "Соседи placement должны быть разными",
      });
    }
  });

export const columnPlacementSchema = z
  .object({
    beforeColumnId: targetUuidV4Schema.nullable(),
    afterColumnId: targetUuidV4Schema.nullable(),
  })
  .strict()
  .superRefine(({ beforeColumnId, afterColumnId }, context) => {
    if (beforeColumnId !== null && beforeColumnId === afterColumnId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["afterColumnId"],
        message: "Соседи placement должны быть разными",
      });
    }
  });

export const actionItemPlacementSchema = z
  .object({
    beforeActionItemId: targetUuidV4Schema.nullable(),
    afterActionItemId: targetUuidV4Schema.nullable(),
  })
  .strict()
  .superRefine(({ beforeActionItemId, afterActionItemId }, context) => {
    if (beforeActionItemId !== null && beforeActionItemId === afterActionItemId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["afterActionItemId"],
        message: "Соседи placement должны быть разными",
      });
    }
  });

const pageLimitSchema = z.preprocess(
  (value) => value ?? TARGET_DEFAULT_PAGE_SIZE,
  z.coerce.number().int().min(1).max(TARGET_MAX_PAGE_SIZE),
);

export const opaqueCursorSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, "Cursor должен быть base64url-строкой");

export const targetBoardPageQuerySchema = z
  .object({
    limit: pageLimitSchema,
  })
  .strict();

export const targetCardPageQuerySchema = z
  .object({
    columnId: targetUuidV4Schema,
    cursor: opaqueCursorSchema.optional(),
    limit: pageLimitSchema,
  })
  .strict();

export const createTargetBoardSchema = z
  .object({
    title: boardTitleSchema,
  })
  .strict();

export const patchTargetBoardSchema = z
  .object({
    title: boardTitleSchema.optional(),
    cardsEnabled: z.boolean().optional(),
    votingEnabled: z.boolean().optional(),
    readOnly: z.boolean().optional(),
  })
  .strict()
  .refine(
    ({ title, cardsEnabled, votingEnabled, readOnly }) =>
      title !== undefined ||
      cardsEnabled !== undefined ||
      votingEnabled !== undefined ||
      readOnly !== undefined,
    { message: "PATCH должен содержать хотя бы одно изменяемое поле" },
  );

export const createTargetColumnSchema = z
  .object({
    title: columnTitleSchema,
    voteLimit: columnVoteLimitSchema,
    placement: columnPlacementSchema,
    expectedRevision: revisionSchema,
  })
  .strict();

export const patchTargetColumnSchema = z
  .object({
    title: columnTitleSchema.optional(),
    voteLimit: columnVoteLimitSchema.optional(),
    expectedRevision: revisionSchema.optional(),
  })
  .strict()
  .superRefine(({ title, voteLimit, expectedRevision }, context) => {
    if (title === undefined && voteLimit === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PATCH должен содержать title или voteLimit",
      });
    }

    if (voteLimit !== undefined && expectedRevision === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedRevision"],
        message: "expectedRevision обязателен при изменении voteLimit",
      });
    }
  });

export const moveTargetColumnSchema = z
  .object({
    placement: columnPlacementSchema,
    expectedRevision: revisionSchema,
  })
  .strict();

const deleteEmptyTargetColumnSchema = z
  .object({
    expectedRevision: revisionSchema,
  })
  .strict();

const moveCardsAndDeleteTargetColumnSchema = z
  .object({
    strategy: z.literal("moveCards"),
    targetColumnId: targetUuidV4Schema,
    expectedRevision: revisionSchema,
  })
  .strict();

const deleteCardsAndTargetColumnSchema = z
  .object({
    strategy: z.literal("deleteCards"),
    confirmDeleteCards: z.literal(true),
    expectedRevision: revisionSchema,
  })
  .strict();

export const deleteTargetColumnSchema = z.union([
  deleteEmptyTargetColumnSchema,
  moveCardsAndDeleteTargetColumnSchema,
  deleteCardsAndTargetColumnSchema,
]);

export const createTargetCardSchema = z
  .object({
    columnId: targetUuidV4Schema,
    text: cardTextSchema,
    author: cardAuthorSchema.optional().default(null),
  })
  .strict();

export const patchTargetCardSchema = z
  .object({
    text: cardTextSchema.optional(),
    author: cardAuthorSchema.optional(),
  })
  .strict()
  .refine(({ text, author }) => text !== undefined || author !== undefined, {
    message: "PATCH должен содержать text или author",
  });

export const moveTargetCardSchema = z
  .object({
    targetColumnId: targetUuidV4Schema,
    placement: itemPlacementSchema,
    expectedRevision: revisionSchema,
  })
  .strict();

export const deleteTargetCardSchema = z
  .object({
    expectedRevision: revisionSchema,
  })
  .strict();

export const resetTargetVotesSchema = z
  .object({
    confirmation: z.literal("RESET_VOTES"),
    expectedRevision: revisionSchema,
  })
  .strict();

export const targetVoteMutationBodySchema = z.undefined();

export const createTargetGroupSchema = z
  .object({
    columnId: targetUuidV4Schema,
    cardIds: z.array(targetUuidV4Schema).min(2).max(TARGET_MAX_GROUP_CARDS),
    primaryCardId: targetUuidV4Schema,
    title: groupTitleSchema.optional().default(null),
    expectedRevision: revisionSchema,
  })
  .strict()
  .superRefine(({ cardIds, primaryCardId }, context) => {
    if (new Set(cardIds).size !== cardIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cardIds"],
        message: "cardIds не должны содержать дубликаты",
      });
    }

    if (!cardIds.includes(primaryCardId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primaryCardId"],
        message: "primaryCardId должен входить в cardIds",
      });
    }
  });

export const patchTargetGroupSchema = z
  .object({
    title: groupTitleSchema.optional(),
    primaryCardId: targetUuidV4Schema.optional(),
    expectedRevision: revisionSchema.optional(),
  })
  .strict()
  .superRefine(({ title, primaryCardId, expectedRevision }, context) => {
    if (title === undefined && primaryCardId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PATCH должен содержать title или primaryCardId",
      });
    }

    if (primaryCardId !== undefined && expectedRevision === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedRevision"],
        message: "expectedRevision обязателен при изменении primaryCardId",
      });
    }
  });

export const moveTargetGroupSchema = z
  .object({
    targetColumnId: targetUuidV4Schema,
    placement: itemPlacementSchema,
    expectedRevision: revisionSchema,
  })
  .strict();

export const ungroupTargetGroupSchema = z
  .object({
    expectedRevision: revisionSchema,
  })
  .strict();

const manualTargetActionItemSchema = z
  .object({
    source: z.literal("manual"),
    text: actionItemTextSchema,
    assignee: actionItemAssigneeSchema.optional().default(null),
  })
  .strict();

const cardTargetActionItemSchema = z
  .object({
    source: z.literal("card"),
    sourceCardId: targetUuidV4Schema,
    assignee: actionItemAssigneeSchema.optional().default(null),
  })
  .strict();

export const createTargetActionItemSchema = z.discriminatedUnion("source", [
  manualTargetActionItemSchema,
  cardTargetActionItemSchema,
]);

export const patchTargetActionItemSchema = z
  .object({
    text: actionItemTextSchema.optional(),
    assignee: actionItemAssigneeSchema.optional(),
    completed: z.boolean().optional(),
  })
  .strict()
  .refine(
    ({ text, assignee, completed }) =>
      text !== undefined || assignee !== undefined || completed !== undefined,
    { message: "PATCH должен содержать хотя бы одно изменяемое поле" },
  );

export const moveTargetActionItemSchema = z
  .object({
    placement: actionItemPlacementSchema,
    expectedRevision: revisionSchema,
  })
  .strict();

export const deleteTargetActionItemSchema = z
  .object({
    expectedRevision: revisionSchema,
  })
  .strict();

export type Revision = z.infer<typeof revisionSchema>;
export type ItemRef = z.infer<typeof itemRefSchema>;
export type ItemPlacement = z.infer<typeof itemPlacementSchema>;
export type ColumnPlacement = z.infer<typeof columnPlacementSchema>;
export type ActionItemPlacement = z.infer<typeof actionItemPlacementSchema>;
export type CreateTargetBoardInput = z.infer<typeof createTargetBoardSchema>;
export type PatchTargetBoardInput = z.infer<typeof patchTargetBoardSchema>;
export type CreateTargetColumnInput = z.infer<typeof createTargetColumnSchema>;
export type PatchTargetColumnInput = z.infer<typeof patchTargetColumnSchema>;
export type MoveTargetColumnInput = z.infer<typeof moveTargetColumnSchema>;
export type DeleteTargetColumnInput = z.infer<typeof deleteTargetColumnSchema>;
export type CreateTargetCardInput = z.infer<typeof createTargetCardSchema>;
export type PatchTargetCardInput = z.infer<typeof patchTargetCardSchema>;
export type MoveTargetCardInput = z.infer<typeof moveTargetCardSchema>;
export type DeleteTargetCardInput = z.infer<typeof deleteTargetCardSchema>;
export type ResetTargetVotesInput = z.infer<typeof resetTargetVotesSchema>;
export type CreateTargetGroupInput = z.infer<typeof createTargetGroupSchema>;
export type PatchTargetGroupInput = z.infer<typeof patchTargetGroupSchema>;
export type MoveTargetGroupInput = z.infer<typeof moveTargetGroupSchema>;
export type UngroupTargetGroupInput = z.infer<typeof ungroupTargetGroupSchema>;
export type CreateTargetActionItemInput = z.infer<typeof createTargetActionItemSchema>;
export type PatchTargetActionItemInput = z.infer<typeof patchTargetActionItemSchema>;
export type MoveTargetActionItemInput = z.infer<typeof moveTargetActionItemSchema>;
export type DeleteTargetActionItemInput = z.infer<typeof deleteTargetActionItemSchema>;
