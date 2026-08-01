export class OperationTimeoutError extends Error {
  constructor() {
    super("Operation timed out");
    this.name = "OperationTimeoutError";
  }
}

export const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive integer");
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new OperationTimeoutError()), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
};
