export const APPLICATION_LIFECYCLE_SUPERVISOR_ENV =
  "BADACTION_APPLICATION_SUPERVISOR";

export const APPLICATION_LIFECYCLE_IPC_NAMESPACE =
  "badaction.application-lifecycle.v1";

type LifecycleReadyMessage = {
  namespace: typeof APPLICATION_LIFECYCLE_IPC_NAMESPACE;
  type: "lifecycle-ready";
};

type PrepareShutdownMessage = {
  namespace: typeof APPLICATION_LIFECYCLE_IPC_NAMESPACE;
  type: "prepare-shutdown";
  requestId: string;
};

type ShutdownPreparedMessage = {
  namespace: typeof APPLICATION_LIFECYCLE_IPC_NAMESPACE;
  type: "shutdown-prepared";
  requestId: string;
};

type ShutdownPrepareFailedMessage = {
  namespace: typeof APPLICATION_LIFECYCLE_IPC_NAMESPACE;
  type: "shutdown-prepare-failed";
  requestId: string;
};

export type ApplicationLifecycleIpcMessage =
  | LifecycleReadyMessage
  | PrepareShutdownMessage
  | ShutdownPreparedMessage
  | ShutdownPrepareFailedMessage;

const hasRequestId = (value: unknown): value is { requestId: string } => {
  if (typeof value !== "object" || value === null || !("requestId" in value)) {
    return false;
  }
  return (
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    value.requestId.length <= 128
  );
};

const hasMessageType = <Type extends ApplicationLifecycleIpcMessage["type"]>(
  value: unknown,
  type: Type,
): value is Extract<ApplicationLifecycleIpcMessage, { type: Type }> =>
  typeof value === "object" &&
  value !== null &&
  "namespace" in value &&
  value.namespace === APPLICATION_LIFECYCLE_IPC_NAMESPACE &&
  "type" in value &&
  value.type === type;

export const createLifecycleReadyMessage = (): LifecycleReadyMessage => ({
  namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
  type: "lifecycle-ready",
});

export const createPrepareShutdownMessage = (
  requestId: string,
): PrepareShutdownMessage => ({
  namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
  type: "prepare-shutdown",
  requestId,
});

export const createShutdownPreparedMessage = (
  requestId: string,
): ShutdownPreparedMessage => ({
  namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
  type: "shutdown-prepared",
  requestId,
});

export const createShutdownPrepareFailedMessage = (
  requestId: string,
): ShutdownPrepareFailedMessage => ({
  namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
  type: "shutdown-prepare-failed",
  requestId,
});

export const isLifecycleReadyMessage = (
  value: unknown,
): value is LifecycleReadyMessage => hasMessageType(value, "lifecycle-ready");

export const isPrepareShutdownMessage = (
  value: unknown,
): value is PrepareShutdownMessage =>
  hasMessageType(value, "prepare-shutdown") && hasRequestId(value);

export const isShutdownPreparedMessage = (
  value: unknown,
): value is ShutdownPreparedMessage =>
  hasMessageType(value, "shutdown-prepared") && hasRequestId(value);

export const isShutdownPrepareFailedMessage = (
  value: unknown,
): value is ShutdownPrepareFailedMessage =>
  hasMessageType(value, "shutdown-prepare-failed") && hasRequestId(value);
