type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : undefined;

const isRetryableSqlState = (value: unknown): boolean =>
  value === "40001" || value === "40P01";

export const isRetryablePrismaTransactionError = (
  error: unknown,
  { retryUniqueConstraint = false }: { retryUniqueConstraint?: boolean } = {},
): boolean => {
  const errorRecord = asRecord(error);
  if (!errorRecord) {
    return false;
  }

  const code = errorRecord.code;
  if (code === "P2034" || (retryUniqueConstraint && code === "P2002")) {
    return true;
  }

  if (isRetryableSqlState(code)) {
    return true;
  }

  if (code !== "P2010") {
    return false;
  }

  const meta = asRecord(errorRecord.meta);
  if (isRetryableSqlState(meta?.code)) {
    return true;
  }

  const driverAdapterError = asRecord(meta?.driverAdapterError);
  const cause = asRecord(driverAdapterError?.cause);
  return (
    cause?.kind === "TransactionWriteConflict" ||
    isRetryableSqlState(cause?.originalCode)
  );
};
