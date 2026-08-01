import type { ZodTypeAny, z } from "zod";
import { requireActiveBoardMember } from "../access/acl-service.ts";
import { getOrSetVisitorToken } from "../cookies/visitor-token.ts";
import { ApiError, toErrorResponse } from "../errors/api-error.ts";
import {
  getTrustedProxyRateLimitIdentity,
  getVisitorRateLimitIdentity,
} from "./client-ip.ts";
import {
  assertNoRequestBody,
  assertSameOriginMutation,
  readJsonBody,
} from "./request-security.ts";
import { assertBoardReadRateLimits } from "../ratelimit/board-read-rate-limit.ts";
import {
  getContentMutationPolicy,
  type ContentMutationName,
} from "../ratelimit/content-mutation-policy.ts";
import { assertRateLimit } from "../ratelimit/memory-rate-limit.ts";
import {
  deriveContentVisitorIdentity,
  type VisitorIdentity,
} from "../services/target-content-service.ts";
import { targetUuidV4Schema } from "../validators/target-content.ts";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

type ContentAccessContext = {
  visitorPayload: string;
  visitorIdentity: VisitorIdentity;
};

const validationError = (message: string, issues: z.ZodIssue[]) =>
  new ApiError(400, "VALIDATION_ERROR", message, { issues });

export const parseContentUuid = (value: string, field: string): string => {
  const parsed = targetUuidV4Schema.safeParse(value);
  if (!parsed.success) {
    throw validationError(
      `Invalid ${field}.`,
      parsed.error.issues.map((issue) => ({
        ...issue,
        path: [field, ...issue.path],
      })),
    );
  }

  return parsed.data;
};

const searchParamsAsStrictInput = (searchParams: URLSearchParams) => {
  const input: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const current = input[key];
    if (current === undefined) {
      input[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      input[key] = [current, value];
    }
  }
  return input;
};

export const parseContentQuery = <Schema extends ZodTypeAny>(
  request: Request,
  schema: Schema,
): z.output<Schema> => {
  const parsed = schema.safeParse(
    searchParamsAsStrictInput(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    throw validationError("Invalid query parameters.", parsed.error.issues);
  }

  return parsed.data;
};

const parseContentJson = async <Schema extends ZodTypeAny>(
  request: Request,
  schema: Schema,
  maxBodyBytes: number,
): Promise<z.output<Schema>> => {
  const body = await readJsonBody(request, maxBodyBytes);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw validationError("Validation failed.", parsed.error.issues);
  }

  return parsed.data;
};

const authorizeBoardAccess = async (
  boardId: string,
  visitorPayload: string,
): Promise<void> => {
  await requireActiveBoardMember(boardId, visitorPayload);
};

const assertContentMutationRateLimits = async ({
  request,
  mutation,
  visitorPayload,
  boardId,
}: {
  request: Request;
  mutation: ContentMutationName;
  visitorPayload: string;
  boardId?: string;
}): Promise<void> => {
  const policy = getContentMutationPolicy(mutation);
  const identityScope = boardId === undefined ? "global" : `board:${boardId}`;
  const keyPrefix = boardId === undefined
    ? policy.rateLimitScope
    : `${policy.rateLimitScope}:${boardId}`;
  const ipIdentity = getTrustedProxyRateLimitIdentity(request.headers, identityScope);
  if (ipIdentity) {
    await assertRateLimit(
      `${keyPrefix}:ip:${ipIdentity}`,
      policy.trustedIpLimit,
      policy.intervalMs,
    );
  }

  const visitorIdentity = getVisitorRateLimitIdentity(visitorPayload, identityScope);
  await assertRateLimit(
    `${keyPrefix}:visitor:${visitorIdentity}`,
    policy.visitorLimit,
    policy.intervalMs,
  );
};

const getMutationAccessContext = async ({
  request,
  mutation,
  boardId,
}: {
  request: Request;
  mutation: ContentMutationName;
  boardId?: string;
}): Promise<{ visitorPayload: string; visitorIdentity?: VisitorIdentity }> => {
  const visitorPayload = await getOrSetVisitorToken();
  if (boardId !== undefined) {
    await authorizeBoardAccess(boardId, visitorPayload);
  }
  await assertContentMutationRateLimits({
    request,
    mutation,
    visitorPayload,
    boardId,
  });

  return {
    visitorPayload,
    visitorIdentity: boardId === undefined
      ? undefined
      : deriveContentVisitorIdentity(boardId, visitorPayload),
  };
};

export const prepareJsonContentMutation = async <Schema extends ZodTypeAny>({
  request,
  mutation,
  schema,
  boardId,
}: {
  request: Request;
  mutation: ContentMutationName;
  schema: Schema;
  boardId?: string;
}): Promise<{
  visitorPayload: string;
  visitorIdentity?: VisitorIdentity;
  payload: z.output<Schema>;
}> => {
  assertSameOriginMutation(request);
  const policy = getContentMutationPolicy(mutation);
  if (policy.requestBody !== "json") {
    throw new TypeError(`${mutation} is not a JSON content mutation`);
  }
  const context = await getMutationAccessContext({ request, mutation, boardId });
  const payload = await parseContentJson(request, schema, policy.maxBodyBytes);
  return { ...context, payload };
};

export const prepareBoardJsonContentMutation = async <Schema extends ZodTypeAny>({
  request,
  mutation,
  schema,
  boardId,
}: {
  request: Request;
  mutation: ContentMutationName;
  schema: Schema;
  boardId: string;
}): Promise<ContentAccessContext & { payload: z.output<Schema> }> => {
  const result = await prepareJsonContentMutation({
    request,
    mutation,
    schema,
    boardId,
  });
  if (result.visitorIdentity === undefined) {
    throw new Error("Board-scoped content mutation did not derive a visitor identity");
  }
  return {
    visitorPayload: result.visitorPayload,
    visitorIdentity: result.visitorIdentity,
    payload: result.payload,
  };
};

export const prepareBodylessContentMutation = async ({
  request,
  mutation,
  boardId,
}: {
  request: Request;
  mutation: ContentMutationName;
  boardId: string;
}): Promise<ContentAccessContext> => {
  assertSameOriginMutation(request);
  const policy = getContentMutationPolicy(mutation);
  if (policy.requestBody !== "none") {
    throw new TypeError(`${mutation} is not a bodyless content mutation`);
  }
  await assertNoRequestBody(request);
  const context = await getMutationAccessContext({ request, mutation, boardId });
  if (context.visitorIdentity === undefined) {
    throw new Error("Board-scoped content mutation did not derive a visitor identity");
  }
  return {
    visitorPayload: context.visitorPayload,
    visitorIdentity: context.visitorIdentity,
  };
};

export const prepareContentRead = async ({
  request,
  boardId,
}: {
  request: Request;
  boardId: string;
}): Promise<ContentAccessContext> => {
  const visitorPayload = await getOrSetVisitorToken();
  await authorizeBoardAccess(boardId, visitorPayload);
  await assertBoardReadRateLimits({
    boardId,
    headers: request.headers,
    visitorPayload,
  });
  return {
    visitorPayload,
    visitorIdentity: deriveContentVisitorIdentity(boardId, visitorPayload),
  };
};

export const prepareContentExport = async ({
  request,
  boardId,
}: {
  request: Request;
  boardId: string;
}): Promise<{ visitorPayload: string }> => {
  const visitorPayload = await getOrSetVisitorToken();
  await authorizeBoardAccess(boardId, visitorPayload);
  const scope = `board:${boardId}`;
  const ipIdentity = getTrustedProxyRateLimitIdentity(request.headers, scope);
  if (ipIdentity) {
    await assertRateLimit(`export:${boardId}:ip:${ipIdentity}`, 100, 60 * 1000);
  }
  const visitorIdentity = getVisitorRateLimitIdentity(visitorPayload, scope);
  await assertRateLimit(`export:${boardId}:visitor:${visitorIdentity}`, 10, 60 * 1000);
  return { visitorPayload };
};

export const noStoreJson = (
  data: unknown,
  init: Omit<ResponseInit, "headers"> & { headers?: HeadersInit } = {},
): Response => {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
};

export const handleContentRoute = async (
  operation: () => Promise<Response>,
): Promise<Response> => {
  try {
    return await operation();
  } catch (error) {
    return toErrorResponse(error);
  }
};
