import { ApiError } from "../errors/api-error-base.ts";
import { getCanonicalAppOrigin } from "./app-origin.ts";

export const JSON_BODY_LIMIT_BYTES = 16 * 1024;

const isJsonContentType = (value: string | null) =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";

export const assertSameOriginMutation = (
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "FORBIDDEN_ORIGIN", "Cross-site requests are not allowed.");
  }

  const canonicalOrigin = getCanonicalAppOrigin(request.url, env);
  const origin = request.headers.get("origin");
  if (!origin) {
    return;
  }

  if (origin !== canonicalOrigin) {
    throw new ApiError(403, "FORBIDDEN_ORIGIN", "Cross-site requests are not allowed.");
  }
};

const assertContentLengthWithinLimit = (request: Request, maxBytes: number) => {
  const rawContentLength = request.headers.get("content-length");
  if (!rawContentLength) {
    return;
  }

  if (!/^\d+$/.test(rawContentLength.trim())) {
    throw new ApiError(400, "INVALID_CONTENT_LENGTH", "Invalid Content-Length.");
  }

  if (Number(rawContentLength) > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }

  return Number(rawContentLength);
};

export const assertNoRequestBody = async (
  request: Request,
  maxBytes: number = JSON_BODY_LIMIT_BYTES,
): Promise<void> => {
  const declaredContentLength = assertContentLengthWithinLimit(request, maxBytes);
  if (declaredContentLength !== undefined && declaredContentLength > 0) {
    throw new ApiError(400, "UNEXPECTED_REQUEST_BODY", "This request must not contain a body.");
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return;
  }

  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (receivedBytes > 0) {
    throw new ApiError(400, "UNEXPECTED_REQUEST_BODY", "This request must not contain a body.");
  }
};

export const readJsonBody = async (
  request: Request,
  maxBytes: number = JSON_BODY_LIMIT_BYTES,
): Promise<unknown> => {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }

  assertContentLengthWithinLimit(request, maxBytes);

  const reader = request.body?.getReader();
  if (!reader) {
    throw new ApiError(400, "INVALID_JSON", "The request body must contain valid JSON.");
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body must contain valid JSON.");
  }
};
